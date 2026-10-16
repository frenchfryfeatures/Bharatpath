"""Questions read aloud (2026-10-16), behind one interface.

The interviewer speaks: each written question is turned into audio on the
server, once, and the app plays it from a presigned link. The text is still
sent and still shown -- audio is how the question is *put*, never the only
way to read it, so a candidate who cannot hear it loses nothing.

Three implementations:

* **Unconfigured** -- the default. The audio route answers 503
  `interview_question_audio_unavailable` and the app shows the text alone.
* **Sarvam** (`sarvam.SarvamSpeechProvider`, `bulbul`) -- the real one. It
  reads every one of our nine locales and processes in India.
* **Stub** -- half a second of silence as WAV, for tests and local work
  without a key; `Settings` refuses it in staging and production.

What a real implementation must satisfy:

  * It is given the question's words and the language to speak them in, and
    nothing else: no name, no CV, no score.
  * It returns audio a phone and a browser can both play, with its MIME type.
  * A failure raises `QuestionAudioUnavailableError`. Nothing is stored, the
    question is unaffected, and the app retries or carries on with the text.
"""

from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from functools import lru_cache
from typing import Final, Protocol

from fastapi import status

from app.core.errors import AppError
from app.settings import get_settings


class QuestionAudioUnavailableError(AppError):
    """No speech provider, or it failed. The question is unaffected: show its
    text, and ask for the audio again if you want it."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "interview_question_audio_unavailable"
    title = "The question could not be read aloud"


@dataclass(frozen=True, slots=True)
class Speech:
    audio: bytes
    mime: str


class SpeechProvider(Protocol):
    name: str
    version: str

    async def speak(self, *, text: str, language: str) -> Speech: ...


class UnconfiguredSpeechProvider:
    name = "none"
    version = "none"

    async def speak(self, *, text: str, language: str) -> Speech:
        raise QuestionAudioUnavailableError()


#: The stub's silence: 16 kHz mono 16-bit, half a second.
_STUB_RATE: Final = 16_000
_STUB_SECONDS: Final = 0.5


class StubSpeechProvider:
    """Silence, as a real WAV file, so a player in local work plays something
    rather than failing on bytes that are not audio. The same for any text."""

    name = "stub"
    version = "stub-1"

    async def speak(self, *, text: str, language: str) -> Speech:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(_STUB_RATE)
            out.writeframes(b"\x00\x00" * int(_STUB_RATE * _STUB_SECONDS))
        return Speech(audio=buffer.getvalue(), mime="audio/wav")


@lru_cache(maxsize=1)
def get_speech_provider() -> SpeechProvider:
    settings = get_settings()
    if settings.interview_question_speech_provider == "sarvam":
        # Imported here: `sarvam` imports this module.
        from app.modules.interview.sarvam import SarvamSpeechProvider

        return SarvamSpeechProvider()
    if settings.interview_question_speech_provider == "stub":
        return StubSpeechProvider()
    return UnconfiguredSpeechProvider()
