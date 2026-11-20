import asyncio
from types import SimpleNamespace

from app.modules.interview import service
from app.modules.interview.bank import SET_TWO
from app.modules.interview.domain import ADAPTIVE_SET_CODE


def test_partial_bank_exposes_all_six_questions_without_changing_saved_wording(monkeypatch):
    saved = [SimpleNamespace(question_index=i, code=q.code, key=q.key,
                             prompt="Saved wording" if i == 0 else q.prompt,
                             looking_for=q.looking_for)
             for i, q in enumerate(SET_TWO.questions[:2])]

    async def questions_for(*args, **kwargs):
        return saved

    monkeypatch.setattr(service.repository, "questions_for", questions_for)
    row = SimpleNamespace(id="fixture", question_set_code=SET_TWO.code, session_number=2)
    result = asyncio.run(service._questions_of(None, row))
    assert len(result.questions) == 6
    assert result.questions[0].prompt == "Saved wording"
    assert result.questions[2:] == SET_TWO.questions[2:]


def test_adaptive_session_does_not_receive_fixed_bank_questions(monkeypatch):
    q = SET_TWO.questions[0]

    async def questions_for(*args, **kwargs):
        return [SimpleNamespace(question_index=0, code=q.code, key=q.key,
                                prompt=q.prompt, looking_for=q.looking_for)]

    monkeypatch.setattr(service.repository, "questions_for", questions_for)
    row = SimpleNamespace(id="adaptive", question_set_code=ADAPTIVE_SET_CODE, session_number=2)
    result = asyncio.run(service._questions_of(None, row))
    assert len(result.questions) == 1
