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

## Design

Colour is the logo's navy and saffron; type is General Sans, shared with the
portal. One radius, no resting shadows, no gradients. The pages show working
pieces of the product (a search, an application tracker, a candidate card, a
cohort panel) rather than illustrations: direction "the product performs",
dealt by the taste-skill and checked against impeccable's craft floor, with
the dark, quiet, fragment-led feel of tryanchora.com as reference. The page
structure (search-first home, audience paths, filterable listing, separate
employer and campus entry points, app download on the home page) follows the
established Indian job-portal pattern without naming any portal.
