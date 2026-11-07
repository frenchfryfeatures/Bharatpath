# BharatPath public website

The marketing site: what BharatPath is, for each of its three audiences, with
a way in for each. It is **separate from the portal** (`../frontend`) on
purpose: a static export with no session, no API calls and **no route to the
admin console**. Every sign-in and sign-up hands over to the portal.

```bash
cd website
npm install
cp .env.example .env.local     # point NEXT_PUBLIC_PORTAL_URL at the portal
npm run dev                    # http://localhost:3100
npm run build                  # static site in out/
```

## Sitemap

| Path | Page | Purpose |
|---|---|---|
| `/` | Home | Hero with a working job search, the three audiences, how it works, trust, **app download (Play Store / App Store)**, FAQ, sign-up |
| `/jobs/` | Job listing | Search + filters: location, work mode, job type, experience, employer size (MSME / startup / enterprise / non-profit), industry, minimum pay, sort. Filters live in the URL |
| `/jobs/<id>/` | Job detail | One page per example role: facts, skills, how applying works, similar roles |
| `/government-jobs/` | Government jobs bulletin | Notices from official government sites, filter by category, state and source; linked from the footer |
| `/students/` | Students & job seekers | CV upload or builder, review before scoring, interview practice, who viewed you, college linking |
| `/employers/` | Employers & MSMEs | Who it is for (MSME first), posting, search, pipeline, team |
| `/colleges/` | Colleges & institutions | Referral codes, seats, student consent, cohort figures |
| `/about/` | About us | Why, who, and the commitments |
| `/faq/` | Questions | Per audience |
| `/contact/` | Contact | Mail routes per audience, grievances |
| `/privacy/`, `/terms/` | Legal | **Plain-language drafts**, marked as such, pending counsel |
| `/login/` | Sign-in chooser | Three doors: candidate, employer, college |
| `/login/{student,employer,college}/` | Role sign-in | Takes the email, hands over to the portal's `/login?as=<role>&email=` |
| `/signup/` | Sign-up chooser | Three doors |
| `/signup/{student,employer,college}/` | Role sign-up | Hands over to the portal's `/signup/<role>` |
| `/sitemap.xml`, `/robots.txt` | | Generated |

Only those three roles are generated (`dynamicParams = false`); there is no
admin page and no link to one. The portal's `LoginForm` reads `?as=` and
locks to that audience, hiding its Admin tab. Staff still sign in from the
portal's bare `/login`, which nothing on this site links to.

## Things that are placeholders

- **The jobs on `/jobs/` and the home hero are examples** (`content/jobs.ts`),
  labelled as such on the page, with organisations described, not named. The
  API has no public jobs endpoint; when one exists, swap `EXAMPLE_JOBS` for a
  fetch at build time or on the client.
- **App Store link**: set `NEXT_PUBLIC_APP_STORE_URL` once the iOS listing
  exists. Until then the badge reads "Coming soon". The Play Store link is
  built from the app's package id, `com.bharatpath.app`.
- **Privacy and terms** are summaries of what the product does. They are not
  legal text. Registered office and Grievance Officer are still to be named.
- No prices are shown: the price list is ours, not the client's
  (`PLACEHOLDER_PRICING`).

## Rules this site keeps

- No age or gender anywhere, including the job filters (invariant 5).
- No financial framing in the copy (invariant 6). The score is never drawn as
  a gauge; bands are a single-hue position marker (`docs/design-system.md` §1).
- Employers are shown the band, never the number; contact details are
  described as behind a profile open, which is what the product does.
- No invented social proof: no logos, testimonials or user counts.

## Government jobs bulletin

`/government-jobs/` lists recruitment notices fetched from official
government websites. `npm run build` runs `scripts/fetch-gov-jobs.mjs` first
(`npm run fetch:gov` runs it alone), which reads `content/gov-sources.json`
and writes `content/gov-jobs.json`; the page is rendered from that file. A
static site only changes when it is rebuilt, so **schedule a daily rebuild**
for the bulletin to stay current.

Sources are empty until the list is confirmed. Each entry:

```json
{
  "id": "ncs",
  "name": "National Career Service",
  "homepage": "https://www.ncs.gov.in/",
  "feed": "https://.../rss.xml",
  "format": "rss",
  "state": "All India",
  "category": "optional, otherwise guessed from the title"
}
```

`format` is `rss` (RSS or Atom) or `json`; a JSON source adds a mapping,
`"json": { "items": "data.notices", "title": "postName", "link": "url",
"published": "date", "lastDate": "closingDate" }`. A source whose site has no
feed needs its own small parser added to the script.

- Only title, link and dates are kept. **Descriptions are dropped**: they
  carry eligibility text, age limits included, and the platform carries no
  age field (invariant 5). Eligibility is read on the official notice.
- A source that fails keeps its previous notices and is marked failing; the
  build never fails over the bulletin. Notices older than 120 days drop off.
- Every notice opens on its official source. The page says BharatPath does
  not run these recruitments and warns against paying for a job.

## Design

The website shares the **student portal's visual language**
(`frontend/features/student`): purple `#5F4DB2` for action, navy ink
`#0A1931`, warm cream grounds (`#FFFCF7`, `#F7F4EC`), lavender and gold tint
cards, 20-28px card radii, pill buttons and General Sans. Tokens are in
`app/globals.css`; buttons, chips and section headings in
`components/ui.tsx`.

Pages are built from modules (search hero, audience doors, category grid,
listing cards, city chips, steps, audience bands, trust grid, app band, FAQ,
sign-up). They show working pieces of the product rather than
illustrations. Layout is checked at 390, 820, 1024, 1440 and 1920px, and
reviewed with impeccable's detector (`impeccable detect <url>`) against the
running site; the cream-palette warning is accepted, because cream is the
portal's own ground.
