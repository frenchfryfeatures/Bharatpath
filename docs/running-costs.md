# BharatPath — Running Cost Estimate: AWS, Sarvam AI, OpenAI

17 October 2026. Shared copy: [Claude doc](https://claude.ai/code/artifact/35489633-095b-453a-822c-6a669ac32bf0).

## Summary

A typical active candidate costs about **₹104 a month in AI services** at 20 hours of use. On top of that, AWS is a fixed **₹3,900 a month today**. At 1,000 active candidates, all-in is about **₹1.17 lakh a month (₹117 per user)**. At 10,000, it is about **₹10.8 lakh a month (₹108 per user)**.

- **The AI job-search assistant is the largest variable cost:** about 60% of a typical user's bill. A monthly message cap is the single biggest lever (see Risks).
- **A mock interview costs about ₹16 per session** (OpenAI ₹6.7, Sarvam ₹8.9). Candidates buy sessions individually, so each sale covers its own cost.
- **Reading a CV costs about ₹5.** The 15-day refresh limit caps this at about ₹9–10 per candidate per month.
- **Employers and colleges call no AI model.** They add only AWS load.
- All figures use list prices as of 17 Oct 2026 and ₹90 = US$1, **excluding 18% GST**. AI token counts are modelled from the code's limits, not yet measured in production.

## Assumptions

Twenty hours of use costs very different amounts depending on what the hours are spent on. Browsing jobs, reading applications or watching a YouTube lesson costs almost nothing beyond AWS. Only three features pay an outside provider per use. The three usage profiles below divide the same 20 hours differently.

| Profile (20 hours / month) | CVs read | Mock interviews | Assistant messages | Rest of the 20 hours |
| --- | --- | --- | --- | --- |
| Light | 1 | 0 | 30 (about 45 minutes of chat) | Browsing, applying, inbox |
| Typical | 2 | 2 (about 40 minutes) | 100 (about 2.5 hours of chat) | Browsing, applying, inbox |
| Heavy | 2 | 8 (about 2.5 hours) | 400 (about 10 hours of chat) | Browsing, applying, inbox |

- **Exchange rate:** ₹90 = US$1. OpenAI and AWS bill in dollars; Sarvam bills in rupees.
- **Prices:** pay-as-you-go list prices read on 17 Oct 2026, excluding GST. No volume discounts or reserved capacity are assumed.
- **Chat pace:** one assistant message about every 1.5 minutes while chatting, or 40 an hour.
- **Interview:** 6 questions per session, each read aloud. Answers average 90 seconds against a 120-second cap, so a session is about 15–20 minutes.
- **CVs read** is capped at 2 a month by the 15-day refresh limit (see that section).

## AWS infrastructure

AWS costs **US$43 (about ₹3,900) a month today**. That figure is measured from AWS's own price list for the live deployment in Mumbai. It is a fixed cost: it does not move with each click. The setup has to grow in steps as users grow, and the step sizes below are our estimate.

| Line item, US$ / month | Today (pilot, up to ~300 users) | ~1,000 active users | ~10,000 active users |
| --- | --- | --- | --- |
| App server (API, worker, scheduler, Redis) | 16.35 — 1 × t3.small | 65.70 — 1 × t3.large | 143.08 — 2 × c7g.xlarge |
| Database (RDS PostgreSQL) | 15.33 — db.t4g.micro | 61.32 — db.t4g.medium | 122.64 — db.t4g.medium, Multi-AZ standby |
| Database storage | 2.62 — 20 GB | 6.55 — 50 GB | 26.20 — 100 GB, Multi-AZ |
| Load balancer | — | — | ~25 (approximate) |
| Server disks, public IPs, secrets | 8.04 | 8.04 | ~18.55 |
| S3 files and outbound data | cents | ~5 | ~112 (approximate: 500 GB stored, 1 TB out) |
| Logs and monitoring | cents | cents | ~10 (approximate) |
| **Total, US$** | **~43** | **~147** | **~458** |
| **Total, ₹** | **~3,900** | **~13,200** | **~41,200** |

- **Free or near-free at these sizes:** Cognito sign-in (no charge up to about 10,000 monthly users), SES email at US$0.10 per 1,000 emails, and Textract, which runs only on scanned CVs. Expo push notifications are free.
- **Outside AWS:** the web portals are hosted on Vercel, billed separately (about US$20 per team seat a month on its Pro plan, approximate).
- **The account is on AWS's Free plan.** It closes on 2027-04-01 or when its credit runs out, whichever comes first, and must be upgraded to a paid plan before then. Instance prices are from Vantage's AWS price pages; the measured pilot figure is from [aws-deployment.md](aws-deployment.md) §0.3.

## OpenAI

Every OpenAI feature runs on **gpt-5.4-mini** (snapshot `gpt-5.4-mini-2026-03-17`). It costs **US$0.75 per million input tokens, US$0.075 for cached input and US$4.50 for output**. The model's thinking is billed as output, which is why output dominates every row below.

| Feature | When it runs | Tokens in / out (estimate) | Cost per use |
| --- | --- | --- | --- |
| CV read for the review screen | Every new CV version | 4,000 / 3,000 | US$0.017 · ₹1.49 |
| Onboarding pre-filled from the CV | On upload | 3,000 / 1,500 | US$0.009 · ₹0.81 |
| Facts extracted for the score | On confirm; once per distinct CV text | 5,000 / 5,000 | US$0.026 · ₹2.36 |
| **Per CV, all three** | | | **US$0.052 · ₹4.7** |
| Interview question written | 6 per session | 3,500 / 1,000 each | US$0.043 · ₹3.85 per session |
| Interview feedback report | Once per session | 6,000 / 6,000 | US$0.032 · ₹2.84 |
| **Per interview session (OpenAI part)** | | | **US$0.074 · ₹6.7** |
| Job-search assistant reply | Each message | 5,000 (half cached) / 1,000 | US$0.007 · ₹0.63 |

- **The code caps the worst case.** Each call has a maximum output size, and a CV over 30,000 characters is refused before any model call. The most a single CV can cost is about ₹15.
- **Identical CV text is read for the score only once.** The result is cached by the text itself, so re-uploading the same file costs only the review-screen reading.
- **Employer, college and staff screens make no OpenAI calls.**

## Sarvam AI

Sarvam is used only in the mock interview, and costs **about ₹8.9 per session**. That is more than OpenAI's share of the same session (₹6.7). It does two jobs: it reads each question aloud, and it transcribes the candidate's spoken answers. Sarvam bills in rupees and processes in India.

| Use | Model | Rate (pay as you go) | Per session |
| --- | --- | --- | --- |
| Answers transcribed (speech to text) | Saaras v3 | ₹0.49 per minute of audio | ₹4.41 (6 answers × 90 s = 9 min) |
| Questions read aloud (text to speech) | Bulbul v3 | ₹3.00 per 1,000 characters | ₹4.50 (6 questions × ~250 characters) |
| **Total** | | | **₹8.91** |

- **Each answer is transcribed once.** Each question is spoken once and the audio file is kept, so listening again costs nothing.
- **Worst case per session is about ₹10.6.** That is every answer at the full 120-second limit, or 12.5 minutes of audio.
- **Volume plans lower both rates.** On the Growth plan (₹10,000 a month), speech to text is ₹0.41 a minute and text to speech is ₹2.70 per 1,000 characters, about 13% cheaper. At around 1,000 active users we would spend more than ₹10,000 a month anyway, so the plan pays for itself there.
- **The newer Bulbul V4 Flash voice is ₹2.00 per 1,000 characters,** a third cheaper to read questions aloud. Switching changes how the questions sound, so it needs a listening check first.

## Cost per user at 20 hours a month

At 20 hours a month, a typical candidate costs **about ₹117 all-in**: ₹104 of AI services and a ₹13 share of AWS. The rates applied are ₹4.7 per CV, ₹15.6 per interview session and ₹0.63 per assistant message.

| Profile | CVs | Mock interviews | Assistant | AI total | AWS share (at 1,000 users) | **All-in, ₹ / user / month** |
| --- | --- | --- | --- | --- | --- | --- |
| Light | ₹4.7 | ₹0 | ₹18.9 | ₹23.6 | ₹13.2 | **₹36.8** |
| Typical | ₹9.4 | ₹31.2 | ₹63.0 | ₹103.6 | ₹13.2 | **₹116.8** |
| Heavy | ₹9.4 | ₹124.8 | ₹252.0 | ₹386.2 | ₹13.2 | **₹399.4** |
| Ceiling, no assistant cap | ₹9.4 | ₹0 | ₹1,512.0 | ₹1,521.4 | ₹13.2 | **₹1,534.6** |

- **The ceiling is the reason for a cap.** The assistant's current limit is 120 messages an hour. A user who spent all 20 hours chatting at that pace would cost about ₹1,500 a month. A cap of 300 messages a month holds the assistant at ₹189 and costs a typical user nothing.
- **Interview spending is covered by its price.** Sessions are bought one at a time, so the heavy profile's ₹125 comes with eight session sales. The session price should stay above ₹16 plus GST.
- **Employers and colleges cost only their AWS share.** They call no AI model, so 20 hours of employer use is about ₹13 a month at 1,000 users.

## Cost at scale

At 1,000 typical active candidates, the platform costs **about ₹1.17 lakh a month**. OpenAI is three-quarters of that. The cost per user falls as users grow, because the AWS cost is shared by more people.

| Active candidates (typical profile) | OpenAI, ₹ | Sarvam, ₹ | AWS, ₹ | **Total, ₹ / month** | Per user, ₹ |
| --- | --- | --- | --- | --- | --- |
| 100 | 8,580 | 1,780 | 3,900 | **14,260** | 142.6 |
| 1,000 | 85,800 | 17,800 | 13,200 | **1,16,800** | 116.8 |
| 10,000 | 8,58,000 | 1,78,000 | 41,200 | **10,77,200** | 107.7 |

The figures exclude GST and assume every user is a typical candidate. Employer and college users add only to the AWS column. Sarvam's Growth plan would cut its column by about 13% from 1,000 users upward.

## Resume refresh limit: one update every 15 days

A candidate may replace their CV **once every 15 days**, counted from when their current CV was confirmed. **It is not built yet.** It needs about 1–2 days of backend work, plus a message in the apps.

**What counts as an update.** Anything that produces a new CV to be scored:

- uploading a new file
- pushing a CV from the Resume Builder
- creating a CV from the manual form after the first one

**What does not count:**

- the first CV
- corrections on the review screen before confirming, so a reading mistake never locks anyone out
- an upload that failed to read
- score increases from mock interviews and courses, which add points without a new CV

**How it will be enforced:**

1. A settings row, `resume.refresh_limit` = 15 days, so the client can change the number without a code release.
2. One check runs at the start of every path that creates a CV: upload, Resume Builder push and manual form. It runs before any file is read, so a refused attempt costs nothing.
3. A refusal returns the code `resume_update_too_soon` with the date of the next allowed update. The apps show *"You can update your CV again on 1 November."*
4. A separate limit of 5 upload attempts a day stops repeated uploads that are never confirmed. Each one would still cost about ₹2 to read.
5. Tests cover each entry point, and that the first CV and corrections pass.

**What it saves.** Without the limit, a candidate re-uploading daily would cost about ₹141 a month in CV reading alone. With it, the most is about ₹9.4 a month, plus about ₹1.5 for each correction.

**Decisions for the client:**

- Should the 15 days start at confirmation (proposed) or at upload?
- May staff lift the limit for one candidate, for example after a wrong reading was confirmed?
- Does a student on a college seat follow the same rule?

## Risks and levers

The biggest risk is the assistant without a monthly cap; the biggest unknown is our token estimates.

| Item | Effect | What to do |
| --- | --- | --- |
| No monthly cap on assistant messages | One user can cost about ₹1,500 a month | Cap at 300 messages a month (client decision) |
| Token counts are modelled, not measured | AI rows could be off by ±30% | Read the OpenAI and Sarvam usage dashboards after the first month, then update this document |
| GST at 18% | Every figure here is before tax | Add it to any price quoted to customers |
| OpenAI processes data in the US | Regional processing would add 10% to OpenAI costs | Part of the open data-residency decision (N2) |
| Rupee–dollar rate | A 5% fall in the rupee adds about 4% to the total | Review this document each quarter |
| AWS Free plan ends 2027-04-01 | The account closes if not upgraded | Upgrade to a paid plan before then |
| Server prices are on demand | A 1-year AWS Savings Plan cuts server and database cost by roughly 30% (approximate) | Buy one once usage is steady at 1,000+ users |
| Sarvam rates | Growth plan about 13% cheaper; Bulbul V4 Flash voice a third cheaper | Switch at ~1,000 users; listen-test V4 first |

### Sources

- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and the [gpt-5.4-mini model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini), read 17 Oct 2026
- [Sarvam API pricing](https://www.sarvam.ai/api-pricing), read 17 Oct 2026
- AWS Mumbai instance prices from Vantage: [t3.large](https://instances.vantage.sh/aws/ec2/t3.large?region=ap-south-1), [c7g.xlarge](https://instances.vantage.sh/aws/ec2/c7g.xlarge?region=ap-south-1), [db.t4g.medium](https://instances.vantage.sh/aws/rds/db.t4g.medium?region=ap-south-1)
- Measured pilot cost (US$43 a month) and service layout: [aws-deployment.md](aws-deployment.md) §0.3
- Models, token limits, interview length and assistant rate limit: the backend code (`app/settings.py`, `interview/bank.py`, `assistant/domain.py`)
