"""Generate docs/diagrams/bharatpath-architecture.excalidraw (+ an SVG preview).

Every diagram is data below: nodes placed on a grid, edges between node ids.
Arrows are *bound* to their boxes, so dragging a box in Excalidraw drags its
arrows with it. Re-run after editing:

    python docs/diagrams/gen_excalidraw.py

Open the .excalidraw file at https://excalidraw.com (File -> Open) or with the
VS Code "Excalidraw" extension.
"""

from __future__ import annotations

import json
import math
import random
import textwrap
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent
OUT = HERE / "bharatpath-architecture.excalidraw"
SVG = HERE / "bharatpath-architecture.svg"

random.seed(20260928)

# ---------------------------------------------------------------- palette ---
KINDS = {
    "client": ("#a5d8ff", "#1971c2", "solid"),
    "edge": ("#99e9f2", "#0c8599", "solid"),
    "api": ("#b2f2bb", "#2f9e44", "solid"),
    "worker": ("#ffec99", "#e67700", "solid"),
    "data": ("#d0bfff", "#6741d9", "solid"),
    "ext": ("#ffd8a8", "#e8590c", "solid"),
    "guard": ("#eebefa", "#9c36b5", "solid"),
    "step": ("#e7f5ff", "#1971c2", "solid"),
    "gap": ("#ffe3e3", "#e03131", "dashed"),
    "note": ("#f8f9fa", "#868e96", "solid"),
    "decision": ("#fff3bf", "#e67700", "solid"),
    "state": ("#ffffff", "#343a40", "solid"),
    "terminal": ("#dee2e6", "#343a40", "solid"),
}
EDGE_STYLES = {
    None: ("#343a40", "solid"),
    "dashed": ("#495057", "dashed"),
    "red": ("#e03131", "dashed"),
    "green": ("#2f9e44", "solid"),
    "blue": ("#1971c2", "solid"),
    "orange": ("#e67700", "solid"),
}

FONT = 16
LINE_H = 1.25
CHAR_W = 0.56  # rough average glyph width for fontFamily 2 (Helvetica)


# ----------------------------------------------------------------- model ---
class Diagram:
    def __init__(self, key, title, subtitle, cw=300, rh=150, box_w=250):
        self.key, self.title, self.subtitle = key, title, subtitle
        self.cw, self.rh, self.box_w = cw, rh, box_w
        self.nodes: dict[str, dict] = {}
        self.edges: list[dict] = []

    def n(self, nid, col, row, text, kind="api", w=1.0, shape="rectangle", font=FONT, align=None):
        width = self.box_w * w + (self.cw - self.box_w) * (w - 1)
        self.nodes[nid] = {
            "id": nid, "col": col, "row": row, "text": text, "kind": kind,
            "w": width, "shape": shape, "font": font,
            "align": align or ("left" if kind == "note" else "center"),
        }

    def e(self, a, b, label=None, style=None, via=None, both=False):
        self.edges.append({"a": a, "b": b, "label": label, "style": style, "via": via or [], "both": both})


def wrap(text: str, width_px: float, font: int) -> list[str]:
    per_line = max(8, int((width_px - 24) / (font * CHAR_W)))
    lines: list[str] = []
    for para in text.split("\n"):
        lines.extend(textwrap.wrap(para, per_line) or [""])
    return lines


# ------------------------------------------------------------- diagrams ---
D: list[Diagram] = []

# 1 ------------------------------------------------------------------------
d = Diagram("system", "1. System architecture — what runs where",
            "One image runs as api, worker and beat. Today: one EC2 host with docker compose. "
            "Later: ECS Fargate + RDS (docs/aws-deployment.md §7).", cw=320, rh=165, box_w=270)
d.n("cand", 0, 0, "Candidate app\nAndroid / iOS (native)\ncandidate pool token", "client")
d.n("emp", 1, 0, "Employer console\nbrowser SPA", "client")
d.n("col", 2, 0, "College console\nbrowser SPA", "client")
d.n("adm", 3, 0, "Admin console\nbrowser SPA (platform staff)", "client")
d.n("cdn", 4.4, 0, "CloudFront + S3 (static)\nserves HTML/JS/CSS only\nno DB credentials, no network path", "edge")
d.n("proxy", 1.5, 1.3, "Caddy :443 on EC2 (today)\nALB (ECS Fargate, later)\nhttps://api…/api/v1  · CORS allow-list", "edge", w=1.3)
d.n("cognito", 0, 2.6, "AWS Cognito\n• candidates: email + password\n• business: email + password + TOTP MFA\n(no phone OTP / SMS)", "ext")
d.n("api", 1.5, 2.6, "API — FastAPI / uvicorn\nmodular monolith, 21 modules\nrouter → service → repository", "api", w=1.3)
d.n("beat", 3, 2.6, "Celery Beat\nEXACTLY ONE process\nrelay every 30 s + 7 sweeps", "worker")
d.n("worker", 4.4, 2.6, "Celery worker(s)\nscale horizontally\n17 registered tasks", "worker")
d.n("redis", 0, 4.1, "Redis\nmembership cache (60 s)\nrate limits · idempotency", "data")
d.n("pg", 1.5, 4.1, "PostgreSQL 16\nRLS on tenant / user\nroles: app · migrator · read-only admin\noutbox · audit_events · config_values", "data", w=1.3)
d.n("sqs", 3, 4.1, "SQS queue + DLQ\nCelery broker\n(Redis/local in dev)", "data")
d.n("s3", 4.4, 4.1, "S3 (6 buckets)\nCVs · interview audio\nexports · …  presigned URLs", "data")
d.n("openai", 5.6, 1.3, "OpenAI (or Bedrock)\nLayer 1 CV extraction\noff until key set → score PENDING", "ext")
d.n("textract", 5.6, 2.6, "Textract (ap-south-1)\nOCR only for scanned CVs\n(pypdf/docx first)", "ext")
d.n("ses", 5.6, 3.8, "SES email\nnotifications + Cognito codes", "ext")
d.n("sarvam", 5.6, 4.9, "Sarvam ASR + evaluator\ninterview feedback only", "ext")
d.n("gw", 0, 5.4, "Payment gateway\nSTUB today (D3 undecided)\nsigned HMAC callbacks", "ext")
d.e("adm", "cdn", "download bundle", "dashed")
d.e("cand", "cognito", "sign in → JWT", "blue")
d.e("cand", "proxy", "HTTPS + Bearer", "blue")
d.e("emp", "proxy", None, "blue")
d.e("col", "proxy", None, "blue")
d.e("adm", "proxy", None, "blue")
d.e("proxy", "api")
d.e("api", "cognito", "JWKS verify · AdminCreateUser")
d.e("api", "redis")
d.e("api", "pg", "SQL under RLS")
d.e("beat", "sqs", "publish due tasks")
d.e("sqs", "worker", "consume", both=True)
d.e("worker", "s3")
d.e("worker", "openai")
d.e("worker", "textract")
d.e("worker", "ses")
d.e("worker", "sarvam")
d.e("worker", "pg", "read/write + outbox", "orange", via=[(3.7, 3.45), (2.2, 3.45)])
d.e("gw", "api", "callback (HMAC)", "dashed", via=[(0.75, 5.4), (0.75, 3.45)])
D.append(d)

# 2 ------------------------------------------------------------------------
d = Diagram("request", "2. One API request — auth, tenancy and the write",
            "Cognito says WHO; our memberships table says WHAT, on every request. "
            "A forgotten tenant/user binding reads as empty, not as an error.", cw=300, rh=150, box_w=260)
d.n("c", 0, 0, "Client\nAuthorization: Bearer <JWT>", "client")
d.n("mw", 1, 0, "Middleware\nCORS · X-Request-ID\nglobal rate limit per IP (fails open)", "api")
d.n("tok", 2, 0, "Verify RS256 vs pool JWKS\nwrong pool ⇒ rejected\nlocal RS256 provider in dev/CI only", "guard")
d.n("usr", 3, 0, "users by cognito_sub\n(never returned in any response)\nfirst sign-in adopts row by email + pool", "api")
d.n("mem", 3, 1.2, "memberships → role + tenant\nRedis 60 s cache\nmark_tenant_changed ⇒ distrust cache", "guard")
d.n("gate", 2, 1.2, "Route guards\nrole · KYB · require_active_subscription\n/ access window (read live, never cached)", "guard")
d.n("rt", 1, 1.2, "Router (module)\n/candidate /employer /college /admin\nprefix = namespacing, not authz", "api")
d.n("svc", 0, 1.2, "Service\nset_transaction_tenant(ctx) or\nbind_candidate (app.user_id)", "api")
d.n("repo", 0, 2.5, "Repository\n(routers never import one directly)", "api")
d.n("pg", 1, 2.5, "Postgres — RLS policies\nguard triggers (state machines)\nCHECKs · SECURITY DEFINER fns", "data")
d.n("same", 2, 2.5, "Same transaction:\nbusiness rows + audit_events + outbox\n→ all commit or none", "note")
d.n("err", 3, 2.5, "Errors: application/problem+json\nmatch on `code`, never `title`\ntenant miss = 404, never 403", "note")
d.n("staff", 0, 3.7, "Admin console read\n_reveal(): audit row first,\nthen read-only BYPASSRLS session", "guard", w=1.5)
d.n("lint", 2, 3.7, "import-linter: add-ons ✗ scoring · integrity ✗ scoring · notifications ✗ scoring · "
    "core ✗ modules · nobody imports resume.repository", "note", w=2)
d.e("c", "mw"); d.e("mw", "tok"); d.e("tok", "usr"); d.e("usr", "mem")
d.e("mem", "gate"); d.e("gate", "rt"); d.e("rt", "svc"); d.e("svc", "repo")
d.e("repo", "pg"); d.e("pg", "same", None, "dashed")
D.append(d)

# 3 ------------------------------------------------------------------------
d = Diagram("modules", "3. Module map — 21 modules, 5 surfaces",
            "Green = event-driven calls between modules. Forbidden by .importlinter: questionnaire / interview / courses / integrity / notifications → scoring, engagement ↔ scoring, anyone → resume.repository.",
            cw=290, rh=150, box_w=255)
d.n("hdr_c", 0, 0, "CANDIDATE SIDE", "note", font=18, w=1.4)
d.n("identity", 0, 0.5, "identity\nusers · memberships · tenants\nstaff provisioning", "api")
d.n("candidate", 1, 0.5, "candidate\nprofile · name · location\nmounts the employer REVEAL", "api")
d.n("resume", 2, 0.5, "resume\nupload · parse · review · confirm\nget_scorable_version = only door", "api")
d.n("scoring", 3, 0.5, "scoring\nLayer 1 model · Layers 2+3 code\ninsert_score only · replay()", "guard")
d.n("integrity", 4, 0.5, "integrity\nsignals · HIGH hides candidate\nhumans resolve", "api")
d.n("engagement", 0, 1.6, "engagement\napp-open streaks\nseparate points ≠ score", "api")
d.n("questionnaire", 1, 1.6, "questionnaire (add-on)\nworth ZERO points", "api")
d.n("interview", 2, 1.6, "interview (add-on)\nsessions · audio · evaluation", "api")
d.n("courses", 3, 1.6, "courses (add-on)\npurchases · completions", "api")
d.n("hdr_e", 0, 2.55, "EMPLOYER SIDE", "note", font=18, w=1.4)
d.n("employer", 0, 3.0, "employer\norganisation profile", "api")
d.n("kyb", 1, 3.0, "kyb\nforms · review · kyb_status", "api")
d.n("jobs", 2, 3.0, "jobs\ncompose + candidate board", "api")
d.n("applications", 3, 3.0, "applications\nstage machine · dashboard", "api")
d.n("discovery", 4, 3.0, "discovery\nmasked search · caps · filters", "api")
d.n("hdr_o", 0, 4.05, "COLLEGE · MONEY · PLATFORM", "note", font=18, w=1.4)
d.n("college", 0, 4.5, "college\ncodes · roster · seats · consent", "api")
d.n("analytics", 1, 4.5, "analytics\nfloored aggregates only", "api")
d.n("billing", 2, 4.5, "billing\ncheckout · callbacks · discounts", "worker")
d.n("subscriptions", 3, 4.5, "subscriptions\nplans · renewals · grace", "worker")
d.n("admin", 4, 4.5, "admin\nconsole · disputes · suspension", "api")
d.n("notifications", 1, 5.6, "notifications\nEMAIL + IN_APP only", "worker")
d.n("privacy", 2, 5.6, "privacy\nexport · erasure cascade", "worker")
d.n("core", 3.5, 5.6, "app.core — auth · db/tenant · outbox · audit · ratelimit · storage · i18n",
    "data", w=1.5)
d.e("resume", "scoring", "version_confirmed", "green")
d.e("scoring", "integrity", "score_computed", "green")
d.e("courses", "scoring", "completion → re-score", "green")
d.e("interview", "scoring", None, "green")
d.e("discovery", "integrity", "visibility CTE", "dashed")
d.e("billing", "subscriptions", "grant")
d.e("applications", "admin", "hire_disputed", "dashed")
D.append(d)

# 4 ------------------------------------------------------------------------
d = Diagram("outbox", "4. The event backbone — transactional outbox → relay → tasks",
            "Nothing is granted, re-scored or sent until the relay runs. Delivery is at-least-once, "
            "so every consumer is idempotent by what it acts on.", cw=330, rh=120, box_w=290)
d.n("tx", 0, 0, "Service transaction\nbusiness rows + outbox.emit(...)\ncommit ⇒ event exists; rollback ⇒ it never did", "api")
d.n("ob", 0, 1.3, "outbox table\npublished_at IS NULL\nattempts < 10", "data")
d.n("beat", 0, 2.6, "Celery Beat — every 30 s\n'outbox.relay' (expires 25 s)", "worker")
d.n("relay", 0, 3.9, "outbox.relay\nSELECT … LIMIT 100\nFOR UPDATE SKIP LOCKED", "worker")
d.n("route", 0, 5.2, "routing.EVENT_SUBSCRIPTIONS\nevent_type → task names\n+ TASK_ARGUMENTS", "guard")
d.n("sqs", 0, 6.5, "send_task → SQS → worker\nfail ⇒ attempts+1, retried next tick", "data")
evs = [
    ("e1", "resume.version_confirmed", "t1", "scoring.score_resume\n(idempotent per version)", "worker"),
    ("e2", "scoring.score_computed", "t2", "integrity.detect", "worker"),
    ("e3", "courses.completion_recorded", "t3", "scoring.rescore_for_addons\n(stored extraction, no model call)", "worker"),
    ("e4", "interview.session_completed", "t4", "rescore_for_addons  +  interview.evaluate_session", "worker"),
    ("e5", "billing.callback_received", "t5", "billing.process_callback\n(the only grant path)", "worker"),
    ("e6", "applications.hire_disputed", "t6", "admin.open_hire_dispute", "worker"),
    ("e7", "privacy.export_requested", "t7", "privacy.build_export", "worker"),
    ("e8", "15 NOTIFYING_EVENTS\n(applications.*, billing.payment_*, kyb.*, …)", "t8", "notifications.dispatch\nrow per message · dedupe_key", "worker"),
    ("e9", "resume.file_uploaded", "t9", "NOTHING routes it ⇒ resume.parse\nnever enqueued (see findings)", "gap"),
]
for i, (eid, etext, tid, ttext, tkind) in enumerate(evs):
    d.n(eid, 1.25, i * 0.85, etext, "note" if tkind != "gap" else "gap", align="center")
    d.n(tid, 2.3, i * 0.85, ttext, tkind)
    d.e(eid, tid, None, "red" if tkind == "gap" else "green")
d.n("sweeps", 3.4, 0, "Beat sweeps (no event; the clock)\n"
    "• :05 applications.expire\n• :15 subscriptions.renewals\n• :25 privacy.erase_due\n"
    "• :35 privacy.expire_exports\n• :45 notifications.nudge_incomplete_profiles\n"
    "• :55 notifications.send_orphaned\n• 18:30 UTC discovery.ensure_view_partitions",
    "note", w=1.5)
d.e("tx", "ob", "same COMMIT"); d.e("beat", "relay"); d.e("ob", "relay", None, "dashed", via=[(-0.55, 1.3), (-0.55, 3.9)])
d.e("relay", "route"); d.e("route", "sqs")
d.e("route", "e1", "lookup", "dashed", via=[(0.75, 5.2), (0.75, 0)])
D.append(d)

# 5 ------------------------------------------------------------------------
d = Diagram("cv", "5. Scenario A — a candidate's CV becomes a score, then becomes visible",
            "The confirm gate (SRS 1.4.4): nothing unconfirmed ever reaches scoring. "
            "The model reads; code scores; the model never sees weights or returns a total.",
            cw=320, rh=150, box_w=280)
d.n("s1", 0, 0, "1. POST upload ticket\npresigned PUT — writes NOTHING", "step")
d.n("s2", 1, 0, "2. App PUTs bytes → S3 resumes bucket", "client")
d.n("s3", 2, 0, "3. POST complete\nHEAD + sniff type, size limit, scan\n→ resume_files + outbox file_uploaded", "api")
d.n("gap", 3, 0, "⚠ No subscriber for resume.file_uploaded\nparse_status stays QUEUED in a running system\n(tests call _parse() directly)", "gap")
d.n("alt", 3, 1.1, "Alt entries: paste text / manual form\n→ version_created directly\n(manual form never scores — E6)", "note")
d.n("p1", 2, 1.1, "4. resume.parse (worker)\nidempotent per file · scan gate\npypdf / python-docx", "worker")
d.n("dec", 1, 1.1, "chars < MIN_USEFUL_CHARS?\n(a scan returns '' and 'succeeds')", "decision", shape="diamond", w=1.0)
d.n("tx", 0, 1.1, "Textract OCR\nap-south-1 · per page\n(off ⇒ fail loudly)", "ext")
d.n("ver", 0, 2.3, "5. resume_versions row\nraw_text · parser+version · hidden_text\nparse_status DONE / FAILED / BLOCKED", "data")
d.n("rev", 1, 2.3, "6. Review screen\nsections = a VIEW of raw_text\nedit ⇒ new version (supersedes_id)", "step")
d.n("conf", 2, 2.3, "7. POST confirm\nconfirmed_at latch (WHERE IS NULL)\n→ outbox resume.version_confirmed", "step")
d.n("sc", 3, 2.3, "8. scoring.score_resume\nget_scorable_version\n(confirmed_at IS NOT NULL in SQL)", "worker")
d.n("l1", 3, 3.5, "9. Layer 1 — model reads the CV\ncache key sha256(text+model+prompt+schema)\nfacts + 0–4 ratings, stored once", "ext")
d.n("l23", 2, 3.5, "10. Layers 2 + 3 — versioned code\nfeatures × weights + add-ons (cap +60)\nno model wired ⇒ stays PENDING", "guard")
d.n("ins", 1, 3.5, "11. insert_score (insert-only)\ntrigger → candidate_search_documents\n→ outbox scoring.score_computed", "data")
d.n("int", 0, 3.5, "12. integrity.detect\nintegrity_checks + signals\nHIGH only: injection · hidden text", "worker")
d.n("vis", 0, 4.7, "13. VISIBLE_CANDIDATES_CTE\nscore ∧ integrity row ∧ no OPEN/CONFIRMED HIGH\n→ employer masked search (band only)", "guard", w=1.5)
d.n("me", 2, 4.7, "Candidate sees display_value (floor at serialisation)\nnever a gauge / dial · never the breakdown", "note", w=1.5)
d.e("s1", "s2"); d.e("s2", "s3"); d.e("s3", "gap", None, "red"); d.e("gap", "p1", "should enqueue", "red")
d.e("p1", "dec"); d.e("dec", "tx", "yes"); d.e("dec", "ver", "no", via=[(0.8, 1.75)]); d.e("tx", "ver")
d.e("alt", "rev", None, "dashed", via=[(3.55, 1.75), (1.4, 1.75)])
d.e("ver", "rev"); d.e("rev", "conf"); d.e("conf", "sc", "relay ≤30 s", "green")
d.e("sc", "l1"); d.e("l1", "l23"); d.e("l23", "ins"); d.e("ins", "int", "relay", "green"); d.e("int", "vis")
d.e("ins", "me", None, "dashed")
D.append(d)

# 6 ------------------------------------------------------------------------
d = Diagram("employer", "6. Scenario B — employer: onboard → pay → hire",
            "Organisation, team and KYB stay open so an unpaid employer can onboard; "
            "jobs, pipeline, search and reveal are behind payment (R15).", cw=310, rh=165, box_w=270)
d.n("a1", 0, 0, "Sign up — business pool\nemail + password + TOTP MFA", "step")
d.n("a2", 1, 0, "/auth/me → 403 no_active_membership\n(current_business_identity admits)", "api")
d.n("a3", 2, 0, "Create organisation\n→ tenant + OWNER membership", "api")
d.n("a4", 3, 0, "Invite team\nAdminCreateUser emails temp password", "api")
d.n("k1", 3, 1.1, "Submit KYB form\n(validated server-side)", "step")
d.n("k2", 2, 1.1, "require approval?", "decision", shape="diamond")
d.n("k3", 1, 1.1, "Staff review in admin console\nkyb.review → employers.kyb_status\n(config kyb.require_approval; off ⇒ skipped)", "guard")
d.n("pay", 0, 1.1, "Subscribe (Scenario C)\nsubscription = access window (R14)", "worker")
d.n("j1", 0, 2.2, "Create + publish job\npublish trigger reads kyb_status", "api")
d.n("j2", 1, 2.2, "Job board → candidates apply\n(apply follows discovery visibility)", "client")
d.n("pl", 2, 2.2, "Pipeline (diagram 7)\nemployer moves one stage / rejects", "api")
d.n("s1", 0, 3.3, "Masked search\nVISIBLE CTE ⋈ search documents\nband only · no total · rate-limited", "api")
d.n("s2", 1, 3.3, "Reveal GET /employer/discovery/\ncandidates/{id} — checks first:\nKYB · burst · hourly/daily caps · visible", "guard")
d.n("s3", 2, 3.3, "Same tx: audit_events +\ncandidate_view_events (partitioned)", "data")
d.n("s4", 3, 3.3, "RevealedCandidate\nname · display score · contact\nnever in a list endpoint", "api")
d.n("an", 3, 2.2, "Cap crossing ⇒ anomaly\naudit row + outbox (blocks nothing)", "note")
d.e("a1", "a2"); d.e("a2", "a3"); d.e("a3", "a4"); d.e("a4", "k1")
d.e("k1", "k2"); d.e("k2", "k3", "on"); d.e("k3", "pay", "approved"); d.e("pay", "j1"); d.e("j1", "j2"); d.e("j2", "pl")
d.e("pay", "s1", None, "dashed", via=[(-0.52, 1.1), (-0.52, 3.3)])
d.e("s1", "s2"); d.e("s2", "s3"); d.e("s3", "s4"); d.e("s3", "an", None, "dashed")
D.append(d)

# 7 ------------------------------------------------------------------------
d = Diagram("stages", "7. Application stage machine (guard_application_write)",
            "Defined once in applications.domain; the DB trigger is generated from it and refuses anything else "
            "for every writer.", cw=250, rh=150, box_w=200)
for i, s in enumerate(["SUBMITTED", "VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION"]):
    d.n(s, i, 0, s, "state")
d.n("HIRED", 5, 0, "HIRED\nemployer proposes +\ncandidate confirms", "terminal")
d.n("REJECTED", 1, 1.3, "REJECTED\n(employer)", "terminal")
d.n("WITHDRAWN", 2, 1.3, "WITHDRAWN\n(candidate)", "terminal")
d.n("EXPIRED", 3, 1.3, "EXPIRED\nhourly sweep · inactivity\n(config, default 30 d)", "terminal")
d.n("DISP", 5, 1.3, "hire_disputed\n→ admin.open_hire_dispute\n→ staff dispute queue", "gap")
d.n("n1", 0, 2.4, "Opening a SUBMITTED application records VIEWED first. Candidates are notified on "
    "SHORTLISTED · INTERVIEW · DECISION · REJECTED (not VIEWED). A proposed hire never expires.", "note", w=3)
d.n("n2", 3.2, 2.4, "Every pipeline stage → REJECTED / WITHDRAWN / EXPIRED. "
    "A tenant tx cannot withdraw/confirm/dispute; a candidate tx can do only those.", "note", w=2.8)
for a, b in zip(["SUBMITTED", "VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION"],
                ["VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION", "HIRED"]):
    d.e(a, b, None, "green" if b != "HIRED" else "blue")
d.e("VIEWED", "REJECTED", None, "red"); d.e("SHORTLISTED", "WITHDRAWN", None, "dashed")
d.e("INTERVIEW", "EXPIRED", None, "dashed"); d.e("DECISION", "DISP", "candidate disputes", "red")
D.append(d)

# 8 ------------------------------------------------------------------------
d = Diagram("pay", "8. Scenario C — payment, entitlement and renewal",
            "An entitlement is granted ONLY by billing.process_callback after the callback's HMAC verified. "
            "Money is integer *_minor. The stub bypasses the bank, not the rules.", cw=310, rh=145, box_w=270)
d.n("c1", 0, 0, "POST checkout\nplan · course · interview session", "step")
d.n("c2", 1, 0, "Discount code?\nlock code row · first checkout only\nhold a use CHECKOUT_HOLD_MINUTES", "decision")
d.n("c3", 2, 0, "payments row PENDING\namount_minor · list_amount_minor\n(guard_payment_write)", "data")
d.n("c4", 3, 0, "Provider\nstub today · gateway TBD (D3)", "ext")
d.n("c5", 3, 1.15, "Gateway callback → route\nverify HMAC · store callback\n→ outbox billing.callback_received", "api")
d.n("dev", 4.1, 0.55, "Dev only: POST /billing/dev/\npayments/{id}/simulate\nsigns a real stub callback, sync", "note")
d.n("c6", 2, 1.15, "outbox.relay (≤ 30 s)\n= the delay the payer feels", "worker")
d.n("c7", 1, 1.15, "billing.process_callback\nverified latch → SUCCEEDED / FAILED", "worker")
d.n("c8", 0, 1.15, "Grant: subscriptions · entitlements\ncourse / interview purchase\n+ discount_redemptions row", "guard")
d.n("c9", 0, 2.3, "outbox billing.payment_succeeded / failed\n→ notifications (in-app / email)", "worker")
d.n("r1", 1, 2.3, "subscriptions.renewals (hourly :15)", "worker")
d.n("r2", 2, 2.3, "Pre-debit notice ≥ 24 h\nEMAIL_MANDATE_PRE_DEBIT (mandatory)", "api")
d.n("r3", 3, 2.3, "Debit after debit_not_before\nfor the notified amount only", "api")
d.n("r4", 3, 3.35, "Fail ⇒ GRACE (auto-renew)\ncurrent_period_end moves to grace end", "decision")
d.n("r5", 2, 3.35, "LAPSED / CANCELLED\nnever revived — a new tenure row", "terminal")
d.n("r6", 1, 3.35, "Access = the clock\nrequire_active_subscription reads live", "note")
d.e("c1", "c2"); d.e("c2", "c3"); d.e("c3", "c4"); d.e("c4", "c5", "payer pays")
d.e("dev", "c5", None, "dashed"); d.e("c5", "c6"); d.e("c6", "c7"); d.e("c7", "c8"); d.e("c8", "c9")
d.e("r1", "r2"); d.e("r2", "r3"); d.e("r3", "r4"); d.e("r4", "r5"); d.n("r7", 4.1, 2.3, "Success ⇒ period extended\n→ billing.payment_succeeded", "api")
d.e("r3", "r7", "success", "green")
D.append(d)

# 9 ------------------------------------------------------------------------
d = Diagram("college", "9. Scenario D — college: seats, codes, roster, consent",
            "A student never binds a college's tenant. Two scopes, two acts: ROSTER (counted) and INDIVIDUAL "
            "(seen by name, granted only by the student).", cw=310, rh=145, box_w=270)
d.n("k1", 0, 0, "College signs up (business pool)\ncreates COLLEGE tenant", "step")
d.n("k2", 1, 0, "COLLEGE subscription\n+ allocate_seats (PLATFORM_ADMIN)\n≤ plan seat_allowance", "worker")
d.n("k3", 2, 0, "Issue referral code\nor import roster → preview → commit", "api")
d.n("k4", 3, 0, "Send invitations\ncollege.invitation_sent → email", "api")
d.n("st1", 3, 1.15, "Student: enter code\nor find invitation by own\nverified email", "client")
d.n("st2", 2, 1.15, "SECURITY DEFINER fns\nconsume_referral_code · answer_invitation\nconsent INSERT policy re-checks", "guard")
d.n("st3", 1, 1.15, "ROSTER consent + claim_college_seat\nseat guard counts seats_used\none live seat per student", "data")
d.n("st4", 0, 1.15, "Student is subscribed via seat\ncandidate_has_college_seat (live)", "api")
d.n("in1", 0, 2.3, "Student grants INDIVIDUAL\n(DIRECT, needs live ROSTER)", "step")
d.n("rd1", 1, 2.3, "College reads by name only via\nCOLLEGE_STUDENT_READS (6 fns ⋈ consent)\nevery list page + open audited", "guard")
d.n("rd2", 2, 2.3, "Analytics aggregates\ncohort < 10 ⇒ counts only\ncell < 5 ⇒ null · never cached", "guard")
d.n("rv", 3, 2.3, "Student revokes ROSTER\n⇒ INDIVIDUAL ends + seat released\n(triggers, same statement)", "gap")
d.n("rv2", 3, 3.35, "Notice to college never names\nthe student (E28)", "note")
d.e("k1", "k2"); d.e("k2", "k3"); d.e("k3", "k4"); d.e("k4", "st1")
d.e("st1", "st2"); d.e("st2", "st3"); d.e("st3", "st4"); d.e("st4", "in1"); d.e("in1", "rd1")
d.e("st3", "rd2", "counted", "dashed"); d.e("rv", "rv2")
D.append(d)

# 10 -----------------------------------------------------------------------
d = Diagram("addons", "10. Scenario E — what can and cannot move the score",
            "Score = resume-derived (700 base … 990) + add-ons (cap +60). Every score row is insert-only "
            "and replayable from stored inputs.", cw=310, rh=140, box_w=270)
d.n("co1", 0, 0, "Buy course (Scenario C)", "step")
d.n("co2", 1, 0, "record_completion\nSYSTEM / PLATFORM_ADMIN only (no route)", "api")
d.n("iv1", 0, 1.1, "Buy interview session\ndevice check ≤ 1 h · ack after 3 held", "step")
d.n("iv2", 1, 1.1, "Record answers (audio → S3)\nCOMPLETED needs all answers STORED", "api")
d.n("rs", 2, 0.55, "scoring.rescore_for_addons\nLayers 2+3 over stored extraction\n+20 per course/session · cap +60", "guard")
d.n("ns", 3, 0.55, "New score row\n→ score_computed → integrity", "data")
d.n("ev", 2, 1.65, "interview.evaluate_session\nSarvam ASR + evaluator (stub/none)\nreport levels only — NO number", "worker")
d.n("q", 0, 2.75, "Questionnaire answers\nstored · worth ZERO · routes nowhere", "note")
d.n("sk", 1, 2.75, "Streaks (engagement)\n−10 / +10 / +15 / +20 points\nseparate balance", "note")
d.n("ig", 2, 2.75, "Integrity signals\nhide from search, never move score", "note")
d.n("x", 3, 2.75, "✗ scoring", "gap")
d.e("co1", "co2"); d.e("co2", "rs", "completion_recorded", "green")
d.e("iv1", "iv2"); d.e("iv2", "rs", "session_completed", "green"); d.e("iv2", "ev", None, "green")
d.e("rs", "ns")
d.e("q", "x", None, "red", via=[(0, 3.6), (3, 3.6)]); d.e("sk", "x", None, "red", via=[(1, 3.6), (3, 3.6)])
d.e("ig", "x", None, "red")
D.append(d)

# 11 -----------------------------------------------------------------------
d = Diagram("privacy", "11. Scenario F — data export and erasure (DPDP)",
            "privacy/domain.py names every table: ERASE · RETAIN (payments, audit) · NOT_PERSONAL · SELF_EXPIRING. "
            "A test reads the live schema so a new table cannot escape it.", cw=310, rh=145, box_w=270)
d.n("x1", 0, 0, "POST export request", "step")
d.n("x2", 1, 0, "dsr_requests row\n→ outbox privacy.export_requested", "api")
d.n("x3", 2, 0, "privacy.build_export\nscore yes, breakdown NO\nEXPORT_FORBIDDEN_FIELDS stripped", "worker")
d.n("x4", 3, 0, "Archive in S3 · presigned link\nprivacy.expire_exports hourly\n(gone within 49 h)", "data")
d.n("d1", 0, 1.2, "POST delete request", "step")
d.n("d2", 1, 1.2, "RECEIVED · due in 24 h\nwithdrawable · account still usable", "api")
d.n("d3", 2, 1.2, "privacy.erase_due (hourly :25)", "worker")
d.n("d4", 3, 1.2, "1. Delete S3 objects FIRST\nCVs · audio · export archives", "data")
d.n("d5", 3, 2.35, "2. erase_candidate()\nSECURITY DEFINER · one transaction\nhalf an erasure = a corrupt account", "guard")
d.n("d6", 2, 2.35, "users emptied, not deleted\ncognito_sub → SHA-256 (old token ⇒ account_inactive)", "data")
d.n("d7", 1, 2.35, "Seat released through its guard\nretained pointers cleared (Python)", "api")
d.n("d8", 0, 2.35, "COMPLETED\n(failure ⇒ stays RECEIVED, retried)", "terminal")
d.e("x1", "x2"); d.e("x2", "x3", "relay", "green"); d.e("x3", "x4")
d.e("d1", "d2"); d.e("d2", "d3", "after cooling-off", "dashed"); d.e("d3", "d4"); d.e("d4", "d5")
d.e("d5", "d6"); d.e("d6", "d7"); d.e("d7", "d8")
D.append(d)


# ------------------------------------------------------------- emitter ---
def uid() -> str:
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(16))


def base(kind, x, y, w, h, **kw):
    el = {
        "id": uid(), "type": kind, "x": round(x, 1), "y": round(y, 1),
        "width": round(w, 1), "height": round(h, 1), "angle": 0,
        "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "roundness": None,
        "seed": random.randint(1, 2**31 - 1), "version": 1,
        "versionNonce": random.randint(1, 2**31 - 1), "isDeleted": False,
        "boundElements": [], "updated": 1759017600000, "link": None, "locked": False,
    }
    el.update(kw)
    return el


def text_el(x, y, w, h, text, font=FONT, align="center", valign="middle", container=None, color="#1e1e1e"):
    return base(
        "text", x, y, w, h, strokeColor=color, text=text, originalText=text, fontSize=font,
        fontFamily=2, textAlign=align, verticalAlign=valign, containerId=container,
        lineHeight=LINE_H, autoResize=True, baseline=round(font * 0.9),
    )


def clip(cx, cy, w, h, tx, ty, shape):
    """Point on the box border along the ray from its centre towards (tx, ty)."""
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    if shape == "diamond":
        t = 1 / (abs(dx) / (w / 2) + abs(dy) / (h / 2))
    else:
        t = min((w / 2) / abs(dx) if dx else math.inf, (h / 2) / abs(dy) if dy else math.inf)
    return cx + dx * t, cy + dy * t


elements: list[dict] = []
svg: list[str] = []
GAP = 8
FRAME_PAD = 40
TITLE_H = 90
COLS = 2
col_x = [0, 0]
col_y = [260, 260]
problems: list[str] = []
DASH = ' stroke-dasharray="8 6"'
BOLD = ' font-weight="bold"'
START = ' marker-start="url(#ahs)"'

# Canvas title + legend
elements.append(text_el(0, 0, 1600, 60, "BharatPath — architecture, data flows and scenarios", font=40, align="left"))
elements.append(text_el(0, 64, 2200, 30,
    "Generated from the code on 2026-09-28 by docs/diagrams/gen_excalidraw.py · "
    "every arrow is bound: drag a box and its arrows follow", font=18, align="left", color="#495057"))
lx = 0
for kind, label in [("client", "client / person"), ("api", "API code"), ("worker", "Celery task"),
                    ("data", "data store"), ("ext", "external service"), ("guard", "guard / invariant"),
                    ("step", "user step"), ("gap", "gap / forbidden"), ("note", "note")]:
    bg, stroke, style = KINDS[kind]
    box = base("rectangle", lx, 120, 190, 56, backgroundColor=bg, strokeColor=stroke, strokeStyle=style,
               roundness={"type": 3})
    t = text_el(lx + 8, 136, 174, 22, label, container=box["id"])
    box["boundElements"].append({"type": "text", "id": t["id"]})
    elements += [box, t]
    dash = DASH if style == "dashed" else ""
    svg.append(f'<rect x="{lx}" y="120" width="190" height="56" rx="10" fill="{bg}" stroke="{stroke}" '
               f'stroke-width="2"{dash}/>'
               f'<text x="{lx + 95}" y="153" font-size="16" text-anchor="middle">{escape(label)}</text>')
    lx += 205

frames_order = []
for idx, dg in enumerate(D):
    # Measure nodes.
    for nd in dg.nodes.values():
        lines = wrap(nd["text"], nd["w"] - (60 if nd["shape"] == "diamond" else 0), nd["font"])
        nd["lines"] = lines
        th = len(lines) * nd["font"] * LINE_H
        nd["th"] = th
        nd["h"] = th + (70 if nd["shape"] == "diamond" else 28)
        nd["tw"] = nd["w"] - (100 if nd["shape"] == "diamond" else 20)
    minc = min(n["col"] for n in dg.nodes.values())
    minr = min(n["row"] for n in dg.nodes.values())
    via_cols = [p[0] for e in dg.edges for p in e["via"]] or [minc]
    shift_c = min(minc, min(via_cols))
    extra_left = (minc - shift_c) * dg.cw
    content_w = max(n["col"] * dg.cw + n["w"] for n in dg.nodes.values()) - minc * dg.cw + extra_left
    content_h = max(n["row"] * dg.rh + n["h"] for n in dg.nodes.values()) - minr * dg.rh
    fw = max(content_w + 2 * FRAME_PAD, 900)
    fh = content_h + TITLE_H + 2 * FRAME_PAD
    col = 0 if col_y[0] <= col_y[1] else 1
    if idx == 0:
        col = 0
    fx = col_x[col] if col == 0 else max(col_x[1], 0)
    fy = col_y[col]
    dg.frame = (fx, fy, fw, fh)
    col_y[col] += fh + 140
    if col == 0:
        col_x[1] = max(col_x[1], fx + fw + 160)

    ox = fx + FRAME_PAD + extra_left - minc * dg.cw
    oy = fy + TITLE_H + FRAME_PAD - minr * dg.rh

    def at(c, r, dg=dg, ox=ox, oy=oy):
        return ox + c * dg.cw, oy + r * dg.rh

    frame = base("frame", fx, fy, fw, fh, name=dg.title, strokeColor="#bbb", roughness=0, strokeWidth=1)
    frame_id = frame["id"]
    frames_order.append(frame)
    svg.append(f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" fill="#fff" stroke="#bbb"/>')

    t1 = text_el(fx + FRAME_PAD, fy + 16, fw - 2 * FRAME_PAD, 34, dg.title, font=26, align="left")
    sub_lines = wrap(dg.subtitle, fw - 2 * FRAME_PAD, 16)
    t2 = text_el(fx + FRAME_PAD, fy + 54, fw - 2 * FRAME_PAD, len(sub_lines) * 20, "\n".join(sub_lines),
                 font=16, align="left", color="#495057")
    for t in (t1, t2):
        t["frameId"] = frame_id
        elements.append(t)
    svg.append(f'<text x="{fx + FRAME_PAD}" y="{fy + 44}" font-size="26" font-weight="bold">{escape(dg.title)}</text>')
    for i, ln in enumerate(sub_lines):
        svg.append(f'<text x="{fx + FRAME_PAD}" y="{fy + 70 + i * 20}" font-size="16" fill="#495057">{escape(ln)}</text>')

    # Nodes.
    for nd in dg.nodes.values():
        x, y = at(nd["col"], nd["row"])
        bg, stroke, style = KINDS[nd["kind"]]
        shape = nd["shape"]
        box = base(shape, x, y, nd["w"], nd["h"], backgroundColor=bg, strokeColor=stroke, strokeStyle=style,
                   roundness={"type": 3} if shape == "rectangle" else {"type": 2}, frameId=frame_id)
        nd["el"] = box
        nd["x"], nd["y"] = x, y
        tx = x + (nd["w"] - nd["tw"]) / 2
        ty = y + (nd["h"] - nd["th"]) / 2
        t = text_el(tx, ty, nd["tw"], nd["th"], "\n".join(nd["lines"]), font=nd["font"], align=nd["align"],
                    container=box["id"])
        t["frameId"] = frame_id
        box["boundElements"].append({"type": "text", "id": t["id"]})
        elements += [box, t]
        dash = ' stroke-dasharray="8 6"' if style == "dashed" else ""
        if shape == "diamond":
            pts = f"{x + nd['w'] / 2},{y} {x + nd['w']},{y + nd['h'] / 2} {x + nd['w'] / 2},{y + nd['h']} {x},{y + nd['h'] / 2}"
            svg.append(f'<polygon points="{pts}" fill="{bg}" stroke="{stroke}" stroke-width="2"{dash}/>')
        else:
            svg.append(f'<rect x="{x}" y="{y}" width="{nd["w"]}" height="{nd["h"]}" rx="10" fill="{bg}" '
                       f'stroke="{stroke}" stroke-width="2"{dash}/>')
        anchor = {"center": "middle", "left": "start"}[nd["align"]]
        lx0 = x + nd["w"] / 2 if nd["align"] == "center" else tx
        for i, ln in enumerate(nd["lines"]):
            svg.append(f'<text x="{lx0}" y="{ty + (i + 0.8) * nd["font"] * LINE_H}" font-size="{nd["font"]}" '
                       f'text-anchor="{anchor}"{BOLD if nd["font"] > 16 else ""}>{escape(ln)}</text>')

    # Overlap check.
    ns = list(dg.nodes.values())
    for i in range(len(ns)):
        for j in range(i + 1, len(ns)):
            a, b = ns[i], ns[j]
            if (a["x"] < b["x"] + b["w"] + 10 and b["x"] < a["x"] + a["w"] + 10
                    and a["y"] < b["y"] + b["h"] + 10 and b["y"] < a["y"] + a["h"] + 10):
                problems.append(f"{dg.key}: {a['id']} overlaps {b['id']}")

    # Edges.
    for ed in dg.edges:
        A, B = dg.nodes[ed["a"]], dg.nodes[ed["b"]]
        acx, acy = A["x"] + A["w"] / 2, A["y"] + A["h"] / 2
        bcx, bcy = B["x"] + B["w"] / 2, B["y"] + B["h"] / 2
        # A waypoint is (column, row) in grid units; x is taken at a box's centre.
        vias = [(vx + dg.box_w / 2, vy) for vx, vy in (at(c, r) for c, r in ed["via"])]
        first = vias[0] if vias else (bcx, bcy)
        last = vias[-1] if vias else (acx, acy)
        sx, sy = clip(acx, acy, A["w"] + 2 * GAP, A["h"] + 2 * GAP, *first, A["shape"])
        ex, ey = clip(bcx, bcy, B["w"] + 2 * GAP, B["h"] + 2 * GAP, *last, B["shape"])
        pts_abs = [(sx, sy), *vias, (ex, ey)]
        color, style = EDGE_STYLES[ed["style"]]
        arrow = base(
            "arrow", sx, sy, max(1, abs(ex - sx)), max(1, abs(ey - sy)),
            strokeColor=color, strokeStyle=style, roundness={"type": 2} if not vias else None,
            points=[[round(px - sx, 1), round(py - sy, 1)] for px, py in pts_abs],
            lastCommittedPoint=None,
            startBinding={"elementId": A["el"]["id"], "focus": 0, "gap": GAP},
            endBinding={"elementId": B["el"]["id"], "focus": 0, "gap": GAP},
            startArrowhead="arrow" if ed["both"] else None, endArrowhead="arrow", elbowed=False,
            frameId=frame_id,
        )
        xs = [p[0] for p in arrow["points"]]
        ys = [p[1] for p in arrow["points"]]
        arrow["width"], arrow["height"] = round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)
        A["el"]["boundElements"].append({"type": "arrow", "id": arrow["id"]})
        B["el"]["boundElements"].append({"type": "arrow", "id": arrow["id"]})
        elements.append(arrow)
        dash = ' stroke-dasharray="8 6"' if style == "dashed" else ""
        path = " ".join(f"{px},{py}" for px, py in pts_abs)
        svg.append(f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2"{dash} '
                   f'marker-end="url(#ah)"{START if ed["both"] else ""}/>')
        if ed["label"]:
            # Label at the middle of the longest segment.
            segs = list(zip(pts_abs, pts_abs[1:]))
            (p, q) = max(segs, key=lambda s: math.dist(*s))
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            lw = len(ed["label"]) * 14 * CHAR_W + 8
            lt = text_el(mx - lw / 2, my - 9, lw, 18, ed["label"], font=14, container=arrow["id"], color=color)
            lt["frameId"] = frame_id
            arrow["boundElements"].append({"type": "text", "id": lt["id"]})
            elements.append(lt)
            svg.append(f'<rect x="{mx - lw / 2}" y="{my - 11}" width="{lw}" height="20" fill="#fff" opacity="0.9"/>'
                       f'<text x="{mx}" y="{my + 4}" font-size="14" text-anchor="middle" fill="{color}">'
                       f'{escape(ed["label"])}</text>')

# Frames go first so every child renders above them.
elements = frames_order + elements

doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {"viewBackgroundColor": "#ffffff", "gridSize": 20, "currentItemFontFamily": 2},
    "files": {},
}
OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")

W = max(e["x"] + e["width"] for e in elements) + 40
H = max(e["y"] + e["height"] for e in elements) + 40
SVG.write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 {W} {H}" width="{W}" height="{H}" '
    'font-family="Helvetica, Arial, sans-serif">'
    '<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">'
    '<path d="M0,0 L10,4 L0,8 z" fill="#343a40"/></marker>'
    '<marker id="ahs" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto">'
    '<path d="M10,0 L0,4 L10,8 z" fill="#343a40"/></marker></defs>'
    '<rect x="-20" y="-20" width="100%" height="100%" fill="#f1f3f5"/>'
    '<text x="0" y="40" font-size="40" font-weight="bold">BharatPath — architecture, data flows and scenarios</text>'
    + "".join(svg) + "</svg>",
    encoding="utf-8",
)
print(f"wrote {OUT.name}: {len(elements)} elements, {len(D)} diagrams")
for p in problems:
    print("OVERLAP", p)
