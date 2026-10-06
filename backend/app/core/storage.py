"""S3 access: presigned URLs in, ranged reads back.

**Every bucket is private.** Objects reach clients only through presigned URLs
with a short expiry, never a public read (SRS 1.4.2) -- the buckets carry a
public-access block in `infra/terraform/s3.tf`, so a mistake here fails rather
than quietly publishing a CV.

boto3 is synchronous. Each call is pushed to a worker thread instead of being
awaited directly, because a blocking socket read on the event loop stalls every
other request in the process, and an S3 round trip to Mumbai is long enough to
notice.
"""

from __future__ import annotations

import asyncio
from typing import Any, TypedDict
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger(__name__)


#: One client for the process. boto3 clients are thread-safe and hold a
#: connection pool, so building one per request would throw that pool away
#: every time. Not `lru_cache` keyed on Settings -- Settings is a Pydantic
#: model and is not hashable.
_s3_client: Any | None = None

#: A second client used only to *sign* presigned URLs, against a host a phone
#: or emulator can reach. Server-side reads/writes keep using `_s3_client`
#: (localhost in dev); presigning against localhost produces a URL whose
#: `Host` header is `localhost:4566`, which on a device is the device itself
#: and whose signature cannot be rewritten client-side without breaking it.
_s3_presign_client: Any | None = None


class _LocalCredentials(TypedDict, total=False):
    aws_access_key_id: str
    aws_secret_access_key: str


def _local_credentials() -> _LocalCredentials:
    settings = get_settings()
    if (
        settings.environment == "local"
        and settings.aws_endpoint_url
        and urlparse(settings.aws_endpoint_url).hostname in ("localhost", "127.0.0.1")
    ):
        return {"aws_access_key_id": "local-preview", "aws_secret_access_key": "local-preview"}
    return {}


def get_s3_client() -> Any:
    global _s3_client
    if _s3_client is None:
        settings = get_settings()
        # The regional endpoint is pinned explicitly rather than left to
        # boto3. Given only `region_name`, boto3 signs presigned URLs against
        # the global host `<bucket>.s3.amazonaws.com`, and S3 answers a PUT
        # there with `307 Temporary Redirect` to the regional host. Browsers
        # and mobile HTTP clients do not resend a PUT body across a redirect,
        # so every upload from a real client fails while a curl test passes.
        endpoint = settings.aws_endpoint_url or f"https://s3.{settings.aws_region}.amazonaws.com"
        _s3_client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            **_local_credentials(),
            endpoint_url=endpoint,
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
    return _s3_client


def _get_presign_client() -> Any:
    """The client presigned URLs are signed with.

    When `aws_endpoint_url_external` is set (local dev, so a phone can reach
    LocalStack), this is a client pointed at that host. Otherwise it is the
    same client as `get_s3_client()` — in prod the real regional endpoint is
    reachable from every client, so no second client is needed.
    """
    global _s3_presign_client
    if _s3_presign_client is None:
        settings = get_settings()
        external = settings.aws_endpoint_url_external
        if external:
            _s3_presign_client = boto3.client(
                "s3",
                region_name=settings.aws_region,
                **_local_credentials(),
                endpoint_url=external,
                config=Config(
                    signature_version="s3v4",
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
        else:
            _s3_presign_client = get_s3_client()
    return _s3_presign_client


def dispose_s3() -> None:
    """Drop the cached clients. Called on shutdown and by tests that swap
    settings, so a stale endpoint or credential never outlives its config."""
    global _s3_client, _s3_presign_client
    if _s3_client is not None:
        _s3_client.close()
        _s3_client = None
    if _s3_presign_client is not None and _s3_presign_client is not _s3_client:
        _s3_presign_client.close()
    _s3_presign_client = None


async def presign_put(*, bucket: str, key: str, expires_in: int) -> str:
    """A URL that authorises writing exactly this key, and nothing else.

    Content-Type is deliberately not bound into the signature. Binding it
    would only force the client to repeat a value we refuse to trust anyway --
    the type is sniffed from the stored bytes afterwards.

    Signed with `_get_presign_client()`, which targets `aws_endpoint_url_external`
    when set, so the URL's host is one a phone or emulator can reach. The
    server-side read of the same object still goes through `get_s3_client()`
    (localhost in dev); the two clients point at the same store.
    """
    client = _get_presign_client()
    return await asyncio.to_thread(
        client.generate_presigned_url,
        "put_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


async def presign_get(*, bucket: str, key: str, expires_in: int) -> str:
    client = _get_presign_client()
    return await asyncio.to_thread(
        client.generate_presigned_url,
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


async def head_object(*, bucket: str, key: str) -> dict[str, Any] | None:
    """Size and metadata, or `None` if the object is not there.

    A missing object is an ordinary outcome, not an error: it is what a client
    claiming to have finished an upload that never happened looks like.
    """
    client = get_s3_client()
    try:
        response = await asyncio.to_thread(client.head_object, Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return {
        "size_bytes": int(response["ContentLength"]),
        "etag": str(response.get("ETag", "")).strip('"'),
    }


async def read_head_bytes(*, bucket: str, key: str, count: int) -> bytes:
    """The first `count` bytes, as a ranged GET.

    Ranged rather than whole-object on purpose: identifying a file needs a few
    bytes, and pulling a 10 MB upload into memory to read eight of them is how
    a file-type check becomes a denial-of-service vector.
    """
    client = get_s3_client()
    try:
        response = await asyncio.to_thread(
            client.get_object, Bucket=bucket, Key=key, Range=f"bytes=0-{count - 1}"
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in ("404", "NoSuchKey", "NotFound"):
            return b""
        # A range beyond a short object is not a failure -- read it whole.
        if code == "InvalidRange":
            response = await asyncio.to_thread(client.get_object, Bucket=bucket, Key=key)
        else:
            raise
    body = response["Body"]
    try:
        return bytes(await asyncio.to_thread(body.read))
    finally:
        await asyncio.to_thread(body.close)


async def read_whole_object(*, bucket: str, key: str) -> bytes:
    """The complete object. Used by the parser, which needs all of it.

    Separate from `read_head_bytes` so the size of the read is always an
    explicit choice at the call site: identifying a file must stay cheap even
    though parsing one cannot be. The upload cap bounds what this can pull
    into memory.
    """
    client = get_s3_client()
    try:
        response = await asyncio.to_thread(client.get_object, Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return b""
        raise
    body = response["Body"]
    try:
        return bytes(await asyncio.to_thread(body.read))
    finally:
        await asyncio.to_thread(body.close)


async def delete_object(*, bucket: str, key: str) -> None:
    """Remove an object. Used to clean up an upload that failed validation, so
    a rejected file does not sit in a bucket accruing storage and obligations
    under DPDP."""
    client = get_s3_client()
    await asyncio.to_thread(client.delete_object, Bucket=bucket, Key=key)


async def put_object(*, bucket: str, key: str, body: bytes, content_type: str) -> None:
    """Write an object the server built itself, **encrypted at rest**.

    Used for data-subject exports (Day 20), which are a whole person's data in
    one file. `ServerSideEncryption` is set on the request rather than trusted
    to a bucket default, so an export can never land unencrypted because
    somebody changed a bucket in the console. The archive is not additionally
    password-protected: a password has to reach the requester by some second
    channel, and every channel we have is the same account the download link
    already goes to.
    """
    client = get_s3_client()
    await asyncio.to_thread(
        client.put_object,
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        ServerSideEncryption="AES256",
    )
