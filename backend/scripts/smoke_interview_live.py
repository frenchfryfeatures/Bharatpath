"""Live check of the mock interview's AI: real OpenAI and real Sarvam.

    cd backend && .venv/Scripts/python.exe scripts/smoke_interview_live.py

**Spends money** (a few cents): every call below is a real, billed request.
Uses the keys and model ids in `.env`. Nothing is written to the database or
S3; the candidate is fictional.

What it proves, end to end, with the same code the API runs:

  1. OpenAI writes question 1 from a CV (contacts stripped first) and the
     onboarding answers, and it passes `parse_drafted_question`.
  2. An answer is spoken (OpenAI text-to-speech, Opus in Ogg -- what the app
     records), sniffed as audio, and transcribed by Sarvam.
  3. OpenAI writes each next question having heard that answer: six in all.
  4. The OpenAI evaluator rates the session and `parse_evaluation` accepts it.
  5. A second session is written with the first one's questions as history,
     and repeats none of them.

Exits non-zero on the first failure.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.modules.interview.bank import DIMENSION_CODES, QUESTIONS_PER_SESSION
from app.modules.interview.domain import (
    QuestionInvalid,
    normalise_prompt,
    parse_drafted_question,
    parse_evaluation,
    redact_contacts,
    sniff_audio,
)
from app.modules.interview.evaluation import AnswerForEvaluation
from app.modules.interview.openai_evaluator import OpenAIEvaluationProvider
from app.modules.interview.openai_questioner import OpenAIQuestionProvider
from app.modules.interview.questions import AskedInThisSession, QuestionContext
from app.modules.interview.sarvam import SarvamTranscriptionProvider
from app.settings import get_settings

CV = """Ravi Kumar
ravi.kumar.demo@example.com | +91 98765 43210
Warehouse Supervisor, Chakan Logistics Park, Pune (2021 - present)
- Run the night shift: 14 loaders and 3 forklift operators across two docks.
- Brought truck turnaround from 95 to 60 minutes by re-sequencing dock slots.
- Trained 9 new joiners on the handheld scanner and the WMS.
Forklift Operator, Mahindra Logistics, Nashik (2017 - 2021)
- Licensed reach-truck operator; zero incidents in four years.
Skills: inventory counts, WMS (SAP EWM), shift rostering, safety audits.
Languages: Marathi, Hindi, English."""

ONBOARDING = (
    ("Which shifts could you work?", "Night shift, Rotational shifts"),
    ("Would you move to another city for the right job?", "Yes, within my state"),
    ("Which languages can you hold a work conversation in?", "Marathi, Hindi, English"),
)

#: What the candidate "says", one per question, in the Hinglish a real
#: candidate would use. Spoken by TTS, then heard by Sarvam.
ANSWERS = (
    "Main Chakan mein warehouse supervisor hoon. Night shift mein chaudah loaders aur teen "
    "forklift operators ko sambhalta hoon, aur dock scheduling mera kaam hai.",
    "Pehle trucks ek ghante se zyada ruk jaate the. Maine dock slots ka order badla, heavy "
    "loads pehle liye, aur turnaround saath minute tak aa gaya.",
    "Ek baar do loaders mein jhagda hua shift ke beech. Maine dono ko alag karke baat ki, kaam "
    "baant diya, aur agle din saath baith ke solve kiya.",
    "New joiners ko main pehle scanner khud chala ke dikhata hoon, phir unse karwata hoon. Nau "
    "logon ko aise train kiya hai.",
    "Safety mere liye sabse pehle hai. Chaar saal forklift chalaya, ek bhi incident nahi hua, "
    "kyunki main har shift se pehle check karta hoon.",
    "Aage main warehouse manager banna chahta hoon, jahan poore site ki planning main karun.",
)


def ok(message: str) -> None:
    print(f"  OK   {message}")


def fail(message: str) -> None:
    print(f"  FAIL {message}")
    raise SystemExit(1)


async def speak(text: str) -> bytes:
    """OpenAI text-to-speech, Opus in Ogg: the container the app records to."""
    settings = get_settings()
    assert settings.openai_api_key is not None
    async with httpx.AsyncClient(base_url=settings.openai_base_url, timeout=60) as client:
        response = await client.post(
            "/audio/speech",
            headers={"Authorization": f"Bearer {settings.openai_api_key.get_secret_value()}"},
            json={
                "model": "gpt-4o-mini-tts",
                "voice": "alloy",
                "input": text,
                "response_format": "opus",
            },
        )
    if response.status_code != 200:
        fail(f"text-to-speech answered {response.status_code}: {response.text[:200]}")
    return response.content


async def write_session(
    writer: OpenAIQuestionProvider,
    *,
    session_number: int,
    earlier: tuple[str, ...],
    resume: str,
    hear: bool,
) -> tuple[list[str], list[AnswerForEvaluation]]:
    transcriber = SarvamTranscriptionProvider()
    this_session: list[AskedInThisSession] = []
    prompts: list[str] = []
    answers: list[AnswerForEvaluation] = []
    for index in range(QUESTIONS_PER_SESSION):
        context = QuestionContext(
            session_number=session_number,
            index=index,
            total=QUESTIONS_PER_SESSION,
            language="hi",
            resume_text=resume,
            onboarding=ONBOARDING,
            earlier_questions=earlier,
            this_session=tuple(this_session),
        )
        started = time.monotonic()
        raw = await writer.draft(context=context)
        took = time.monotonic() - started
        try:
            drafted = parse_drafted_question(raw, index=index, already_asked=(*earlier, *prompts))
        except QuestionInvalid as exc:
            fail(f"question {index + 1} refused: {exc} -- {raw!r}")
        prompts.append(drafted.prompt)
        ok(f"Q{index + 1} [{drafted.kind}, {took:.1f}s] {drafted.prompt}")

        transcript: str | None = None
        if hear:
            audio = await speak(ANSWERS[index])
            mime = sniff_audio(audio[:64])
            if mime is None:
                fail("the spoken answer is not audio the app would record")
            started = time.monotonic()
            heard = await transcriber.transcribe(audio=audio, mime=mime)
            took = time.monotonic() - started
            if len(heard.text.strip()) < 10:
                fail(f"Sarvam heard almost nothing: {heard.text!r}")
            transcript = heard.text.strip()
            ok(f"   heard [{mime}, {len(audio)} B, {took:.1f}s, {heard.language}] {transcript}")
            answers.append(
                AnswerForEvaluation(
                    question_code=f"S{session_number}Q{index + 1}",
                    prompt=drafted.prompt,
                    looking_for=drafted.looking_for,
                    transcript=transcript,
                )
            )
        this_session.append(AskedInThisSession(drafted.prompt, transcript))
    return prompts, answers


async def main() -> None:
    settings = get_settings()
    print(
        f"question writer: {settings.interview_question_provider} "
        f"{settings.interview_question_model_id}; evaluator: "
        f"{settings.interview_evaluation_provider} {settings.interview_evaluation_model_id}; "
        f"speech: {settings.interview_transcription_provider} {settings.sarvam_stt_model}"
    )
    if settings.openai_api_key is None or settings.sarvam_api_key is None:
        fail("OPENAI_API_KEY and SARVAM_API_KEY must both be set in .env")

    resume = redact_contacts(CV, known=("Ravi Kumar",))
    for leaked in ("ravi.kumar.demo@example.com", "98765 43210", "Ravi Kumar"):
        if leaked in resume:
            fail(f"{leaked!r} would reach the model")
    ok("contact details removed from the CV before it leaves")

    writer = OpenAIQuestionProvider(model_id=settings.interview_question_model_id)
    print("\nSession 1 -- written, spoken, heard:")
    first, answers = await write_session(
        writer, session_number=1, earlier=(), resume=resume, hear=True
    )

    print("\nEvaluation:")
    evaluator = OpenAIEvaluationProvider(model_id=settings.interview_evaluation_model_id)
    started = time.monotonic()
    raw = await evaluator.evaluate(answers=answers)
    evaluations = parse_evaluation(
        raw,
        question_codes=tuple(a.question_code for a in answers),
        dimension_codes=DIMENSION_CODES,
    )
    ok(f"rated {len(evaluations)} answers in {time.monotonic() - started:.1f}s")
    for evaluation in evaluations[:2]:
        ok(f"   {evaluation.question_code}: {evaluation.comment}")

    print("\nSession 2 -- told every question from session 1:")
    second, _ = await write_session(
        writer, session_number=2, earlier=tuple(first), resume=resume, hear=False
    )
    repeated = {normalise_prompt(p) for p in first} & {normalise_prompt(p) for p in second}
    if repeated:
        fail(f"session 2 repeated: {repeated}")
    ok("no question from session 1 was asked again")
    print("\nAll live checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
