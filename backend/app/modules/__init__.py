"""Module registry. The API router walks ALL_MODULES to mount every surface."""

from __future__ import annotations

from types import ModuleType

from . import (
    admin,
    analytics,
    applications,
    billing,
    candidate,
    college,
    courses,
    discovery,
    employer,
    engagement,
    identity,
    integrity,
    interview,
    jobs,
    kyb,
    notifications,
    privacy,
    profile_images,
    questionnaire,
    resume,
    scoring,
    subscriptions,
)

ALL_MODULES: tuple[ModuleType, ...] = (
    identity,
    candidate,
    resume,
    scoring,
    integrity,
    questionnaire,
    interview,
    courses,
    employer,
    kyb,
    jobs,
    applications,
    discovery,
    billing,
    subscriptions,
    college,
    analytics,
    admin,
    notifications,
    privacy,
    engagement,
    profile_images,
)
