"""profile_images - SQLAlchemy ORM models

Everyone's own photo, and employer and college logos. Never the score.

Two tables rather than one with an owner column, because they have opposite
privacy lives (`privacy.domain.ERASURE_PLAN`):

* `user_photos` is personal data, erased with the person.
* `organisation_logos` is an organisation's public face, not personal.

At most one image per owner: the owner's id is the primary key, which is
also the index its foreign key needs. A replaced image's object is deleted
when its row is overwritten, so a key on a row is the only copy there is.

**Not under Row-Level Security.** A photo is read by its owner, whose id
comes from the verified token, and by staff on the bypass session. A logo is
read by every candidate browsing that organisation's jobs, across tenants,
which a tenant policy would refuse. Every repository function takes the
owner's id; `organisation_logos` carries its exemption in the baseline's
`RLS_EXEMPT`.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.modules.profile_images.domain import MAX_EDGE_PX

_STORED_TYPES = "mime IN ('image/jpeg', 'image/png')"
_EDGES = f"width BETWEEN 1 AND {MAX_EDGE_PX} AND height BETWEEN 1 AND {MAX_EDGE_PX}"


class UserPhoto(Base):
    __tablename__ = "user_photos"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    s3_key: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Of the image the server encoded, never the upload's.
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(_STORED_TYPES, name="ck_user_photos_mime"),
        CheckConstraint(_EDGES, name="ck_user_photos_edges"),
    )


class OrganisationLogo(Base):
    __tablename__ = "organisation_logos"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True
    )
    s3_key: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Who put it there: the organisation's owner or admin.
    updated_by: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(_STORED_TYPES, name="ck_organisation_logos_mime"),
        CheckConstraint(_EDGES, name="ck_organisation_logos_edges"),
    )
