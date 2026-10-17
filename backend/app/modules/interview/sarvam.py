"""Speech to text on Sarvam (`saaras`), for mock-interview answers, and text
to speech (`bulbul`), for the questions (2026-10-16, at the end).

**The batch API, not the REST one.** Sarvam's synchronous endpoint takes under
thirty seconds of audio and an answer runs to `bank.ANSWER_SECONDS` (120), so
a REST call would refuse most real answers. A batch job takes up to two hours
per file: create the job, PUT the audio to the signed URL it returns, start
it, poll, then fetch the output JSON through a signed download URL. Latency is
tens of seconds, which is fine -- evaluation runs in a task, after completion.

What `evaluation.TranscriptionProvider` requires, and how this meets it:

* Words as spoken, no translation: mode `codemix` (or `transcribe`), never
  `translate`. Language is auto-detected (`unknown`), so the eight locales and
  code-mixed speech need no hint from us -- and we pass none about the person.
* Silence is an empty string: Sarvam returns an empty transcript for it. A job
  or file that *fails* is not silence, and raises so the task retries.
* Region: Sarvam processes in India. Recorded as `provider` = `sarvam`.
* Transient failure raises `EvaluationUnavailableError`; never partial text.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any, Final

import httpx

from app.core.logging import get_logger
from app.modules.interview.evaluation import EvaluationUnavailableError, Transcript
from app.modules.interview.speech import QuestionAudioUnavailableError, Speech
from app.settings import get_settings

logger = get_logger(__name__)

TIMEOUT: Final = httpx.Timeout(60.0, connect=10.0)
POLL_SECONDS: Final = 3.0
#: A two-minute answer that has not transcribed in five is not going to; the
#: task retries later rather than holding a worker.
MAX_WAIT_SECONDS: Final = 300.0

_EXTENSIONS: Final = {
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
}

#: Replaced in tests with an `httpx.MockTransport`. Never set in the app.
_transport: httpx.AsyncBaseTransport | None = None


class SarvamTranscriptionProvider:
    name = "sarvam"

    def __init__(self) -> None:
        settings = get_settings()
        if settings.sarvam_api_key is None:
            raise EvaluationUnavailableError()
        self._key = settings.sarvam_api_key.get_secret_value()
        self._base = settings.sarvam_base_url
        self._model = settings.sarvam_stt_model
        self._mode = settings.sarvam_stt_mode
        self.version = f"{self._model}/{self._mode}"

    async def transcribe(self, *, audio: bytes, mime: str) -> Transcript:
        file_name = f"answer.{_EXTENSIONS.get(mime.split(';')[0].strip(), 'webm')}"
        try:
            # Two clients: the signed URLs are Azure Blob storage, absolute,
            # and must never be sent our key.
            async with (
                httpx.AsyncClient(
                    base_url=self._base,
                    timeout=TIMEOUT,
                    headers={"api-subscription-key": self._key},
                    transport=_transport,
                ) as client,
                httpx.AsyncClient(timeout=TIMEOUT, transport=_transport) as blob,
            ):
                return await self._run(client, blob, audio=audio, mime=mime, file_name=file_name)
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            # Unreachable, or an answer not in the shape documented -- neither
            # is the candidate's silence, so neither may become an empty text.
            logger.warning(
                "transcription_unavailable", provider="sarvam", reason=type(exc).__name__
            )
            raise EvaluationUnavailableError() from exc

    async def _run(
        self,
        client: httpx.AsyncClient,
        blob: httpx.AsyncClient,
        *,
        audio: bytes,
        mime: str,
        file_name: str,
    ) -> Transcript:
        created = _json(
            await client.post(
                "/speech-to-text/job/v1",
                json={
                    "job_parameters": {
                        "model": self._model,
                        "mode": self._mode,
                        "language_code": "unknown",
                        "with_timestamps": False,
                        "with_diarization": False,
                    }
                },
            )
        )
        job_id = str(created["job_id"])

        links = _json(
            await client.post(
                "/speech-to-text/job/v1/upload-files", json={"job_id": job_id, "files": [file_name]}
            )
        )
        upload_url = links["upload_urls"][file_name]["file_url"]
        put = await blob.put(
            upload_url,
            content=audio,
            headers={
                "x-ms-blob-type": "BlockBlob",
                "Content-Type": mime or "application/octet-stream",
            },
        )
        _raise_for(put, "upload")

        _json(await client.post(f"/speech-to-text/job/v1/{job_id}/start"))
        status = await self._wait(client, job_id)

        details = status.get("job_details") or []
        task = details[0] if details else {}
        outputs = task.get("outputs") or []
        if str(task.get("state")) != "Success" or not outputs:
            logger.warning(
                "transcription_failed",
                provider="sarvam",
                job_state=status.get("job_state"),
                task_state=task.get("state"),
            )
            raise EvaluationUnavailableError()
        output_name = outputs[0]["file_name"]

        links = _json(
            await client.post(
                "/speech-to-text/job/v1/download-files",
                json={"job_id": job_id, "files": [output_name]},
            )
        )
        got = await blob.get(links["download_urls"][output_name]["file_url"])
        _raise_for(got, "download")
        result = got.json()
        text = result.get("transcript")
        if not isinstance(text, str):
            raise EvaluationUnavailableError()
        language = result.get("language_code")
        return Transcript(
            text=text.strip(), language=language if isinstance(language, str) else None
        )

    async def _wait(self, client: httpx.AsyncClient, job_id: str) -> dict[str, Any]:
        waited = 0.0
        while True:
            status = _json(await client.get(f"/speech-to-text/job/v1/{job_id}/status"))
            state = str(status.get("job_state", "")).lower()
            if state in ("completed", "partiallycompleted", "failed"):
                return status
            if waited >= MAX_WAIT_SECONDS:
                logger.warning("transcription_timeout", provider="sarvam", job_state=state)
                raise EvaluationUnavailableError()
            await asyncio.sleep(POLL_SECONDS)
            waited += POLL_SECONDS


def _raise_for(response: httpx.Response, step: str) -> None:
    if not 200 <= response.status_code < 300:
        logger.warning(
            "transcription_refused", provider="sarvam", step=step, status=response.status_code
        )
        raise EvaluationUnavailableError()


def _json(response: httpx.Response) -> dict[str, Any]:
    _raise_for(response, response.request.url.path)
    body: dict[str, Any] = response.json()
    return body


# ---------------------------------------------------------------------------
# Text to speech -- the questions, read aloud (2026-10-16)
# ---------------------------------------------------------------------------
# The REST endpoint, synchronous: a question is a sentence or two, well inside
# `bulbul`'s 2,500 characters, and comes back in a second or two. MP3, not the
# default WAV: a tenth of the size, and a phone and a browser both play it.

TTS_TIMEOUT: Final = httpx.Timeout(30.0, connect=10.0)

#: Our locale -> Sarvam's language. All nine are spoken; anything else is read
#: as Indian English, which also reads code-mixed text.
_TTS_LANGUAGES: Final = {
    code: f"{code}-IN" for code in ("en", "hi", "bn", "kn", "mr", "pa", "gu", "ta", "te")
}


def tts_language(locale: str) -> str:
    return _TTS_LANGUAGES.get(locale.split("-")[0].lower(), "en-IN")


class SarvamSpeechProvider:
    name = "sarvam"

    def __init__(self) -> None:
        settings = get_settings()
        if settings.sarvam_api_key is None:
            raise QuestionAudioUnavailableError()
        self._key = settings.sarvam_api_key.get_secret_value()
        self._base = settings.sarvam_base_url
        self._model = settings.sarvam_tts_model
        self._speaker = settings.sarvam_tts_speaker
        self.version = f"{self._model}/{self._speaker}"

    async def speak(self, *, text: str, language: str) -> Speech:
        try:
            async with httpx.AsyncClient(
                base_url=self._base,
                timeout=TTS_TIMEOUT,
                headers={"api-subscription-key": self._key},
                transport=_transport,
            ) as client:
                response = await client.post(
                    "/text-to-speech",
                    json={
                        "text": text,
                        "language_code": tts_language(language),
                        "model": self._model,
                        "speaker": self._speaker,
                        "output_audio_codec": "mp3",
                    },
                )
            if not 200 <= response.status_code < 300:
                logger.warning("speech_refused", provider="sarvam", status=response.status_code)
                raise QuestionAudioUnavailableError()
            audio = base64.b64decode(response.json()["audios"][0], validate=True)
        # A bad base64 body is a `binascii.Error`, which is a `ValueError`.
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("speech_unavailable", provider="sarvam", reason=type(exc).__name__)
            raise QuestionAudioUnavailableError() from exc
        if not audio:
            logger.warning("speech_empty", provider="sarvam")
            raise QuestionAudioUnavailableError()
        return Speech(audio=audio, mime="audio/mpeg")
