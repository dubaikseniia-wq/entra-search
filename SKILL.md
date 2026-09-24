---
name: entra-search
version: 1.0.0
description: >
  Use this skill to search live AI / software / data / engineering job listings
  across many countries (and remote) on ENTRA (entracareers.com) via its public
  JSON API, or to look up one ENTRA posting. ENTRA ingests every posting straight
  from the employer's own applicant-tracking system (Greenhouse, Lever, Ashby, …),
  so results are structured, current, and carry the employer's own apply link.
  Trigger phrases: find AI jobs, machine learning engineer jobs, AI engineer roles,
  tech jobs at OpenAI/SpaceX/Stripe, remote developer jobs, who is hiring for
  <role>, "are there any <role> jobs in <place>", look up this ENTRA job posting,
  entracareers.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/entra-search/cli/src/cli.ts *)
---

# ENTRA Search Skill

Search live job listings on **[ENTRA](https://entracareers.com)** — a job platform
whose postings are pulled directly from company hiring systems (Greenhouse, Lever,
Ashby and others) rather than reposted or scraped, so every result is a role the
employer is currently running in its own ATS. No authentication, no API key, and
**zero runtime dependencies** — it runs with just `bun`. Geography is chosen per
query (`--location`, `--remote`) and resolved against ENTRA's own country/city
records, so the same skill works for a forker in any of the 36 markets ENTRA
covers.

> This is a country-agnostic worked example of the repo's job-portal-skill pattern,
> like `linkedin-search` and `freehire-search`. It queries ENTRA's public JSON API,
> so results are structured (work mode, experience level, employment type, ATS
> source, employer apply link) rather than parsed from markup.

## ⚠️ Scope: AI & tech-leaning, 36 countries

ENTRA's corpus is strongest for AI, software, data and engineering roles at
technology companies (OpenAI, SpaceX, Stripe and several hundred more), with
postings across North America, Europe, the Middle East, Asia-Pacific, Latin
America and remote. Non-tech postings exist because whole ATS boards are
ingested, but coverage there is incidental — treat this as a tech-first source.

**`--location` covers exactly 36 countries**, the ones ENTRA holds geography
records for:

```
AE  AR  AU  BD  BH  BR  CA  CH  CL  CN  CY  DE  EG  ES  FR  GE  HK  IN
IT  JO  JP  KR  KW  LB  LK  MX  MY  NL  OM  PH  PK  QA  SA  SG  UK  US
```

(live list: `GET https://entracareers.com/api/references/countries?limit=100`)

Anything outside them — `--location Denmark`, `--location Copenhagen` — exits `1`
with a JSON error on stderr that names the supported codes. It never returns an
empty page and calls it a result. Remote roles in uncovered markets are still
reachable with `--remote` and no `--location`.

## ℹ️ Hosted-service dependency

This skill depends on a third-party hosted service, entracareers.com. Reads are
**public and unauthenticated** — the same zero-signup bar as `linkedin-search` and
`freehire-search`. ENTRA explicitly welcomes agent traffic (it publishes an MCP
server and links tag agent visits with `utm_source`), so there is no personal-use
restriction to observe; keep volume reasonable all the same.

If the API is unreachable, the CLI fails gracefully — a non-zero exit with a clear
error message — so an outage degrades this source rather than breaking the
surrounding workflow. The base URL is overridable via `ENTRA_API_URL` (default
`https://entracareers.com/api`) for a staging instance; `ENTRA_SITE_URL` overrides
the public site used in result links.

## When to use this skill

- Search for AI / tech openings by keyword, remote or in a given city/country —
  each result comes back with its **full description**, no per-hit follow-up needed
- Filter by work mode, experience level, employment type, specialization, company,
  stated minimum salary, or recency (posted within N days)
- Look one ENTRA posting up by its id or URL (including an expired one)

## Commands

### Search job listings

```bash
bun run .agents/skills/entra-search/cli/src/cli.ts search [-q "<keywords>"] [filters]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search over title, description and company. Optional.
- `--location <text>` / `-l <text>` — **server-side**. A country code, a country name,
  a city, or `"City, Country"`. The CLI resolves it to ENTRA's `countryId` / `cityId`
  through `GET /references/countries` and `GET /references/cities` (the same way
  `--company` resolves a slug) and passes the ids as real API filters, so it searches
  the whole corpus rather than the page that happened to be fetched. Accepts
  `-l US`, `-l usa`, `-l "United States"`, `-l Berlin`, `-l "San Francisco, US"`;
  case and punctuation are ignored. Unresolvable → exit 1 (see the coverage section
  above). ENTRA's city table has some duplicate rows, so `"City, Country"` is the
  reliable form when a city name exists in more than one country.
- `--remote [mode]` — `remote` (bare flag) | `hybrid` | `office` (`onsite` is accepted as an alias). Server-side.
- `--experience <level>` — `no_experience` | `1_3_years` | `3_6_years` | `6_plus_years`. Server-side.
- `--employment <type>` — `full_time` | `part_time` | `contract` | `freelance` | `internship`. Server-side.
- `--specialization <slugs>` — ENTRA specialization slug(s), comma = OR
  (e.g. `machine-learning-engineer,data-engineer`). Discover slugs at
  `https://entracareers.com/api/specializations`. Server-side.
- `--company <slug|name>` — one company, resolved through the public `/companies`
  search (e.g. `stripe`, `spacex`). Server-side.
- `--salary-min <n>` — only postings whose **stated** minimum salary is ≥ n. Most ATS
  postings state no salary and are excluded by this flag, so use it sparingly.
- `--jobage <days>` — posted within N days. Applied **client-side** on the publication
  date (results arrive newest-first, so it is effective).
- `--sort date|salary` — default `date` (newest first).
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page, 1–100. Default 25.
- `--no-description` — drop description bodies for a cheap discovery pass.
- `--format json|table|plain` — default `json`.

**Search results already carry the full description.** ENTRA's list endpoint
returns each posting's complete text, so a search of 20 roles is 1 request rather
than 1 + 20. Do **not** loop `detail` over search hits to read their descriptions —
reach for `detail` only to look one posting up by id (e.g. from the tracker, or an
expired posting search no longer lists). Full descriptions are verbose: keep
`--limit` modest, and pre-filter on title/company before reading bodies — or pass
`--no-description` for a cheap discovery pass.

### Fetch full job detail

```bash
bun run .agents/skills/entra-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `id` from a `search` result (a UUID such as
`25b71e5a-db28-43a2-84c0-1c7df875a547`). You may also pass a full
`https://entracareers.com/<cc>/vacancies/<uuid>` URL. Returns the description,
requirements (when the employer lists them separately), specialization, expiry
date, `is_active`, the ENTRA page URL and the employer's own `apply_url`.

## Usage examples

```bash
# Remote machine-learning roles, table view
bun run .agents/skills/entra-search/cli/src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table

# Product roles in the United States for 3-6 years' experience
bun run .agents/skills/entra-search/cli/src/cli.ts search -q "product manager" -l "United States" --experience 3_6_years --format table

# One city, disambiguated by country (ENTRA holds a San Francisco in both US and CA)
bun run .agents/skills/entra-search/cli/src/cli.ts search -q engineer -l "San Francisco, US" --limit 10 --format table

# Everything SpaceX posted in the last 14 days
bun run .agents/skills/entra-search/cli/src/cli.ts search --company spacex --jobage 14 --format table

# Data-engineering openings by specialization, full-time only
bun run .agents/skills/entra-search/cli/src/cli.ts search --specialization data-engineer --employment full_time --format table

# Cheap discovery pass, then read one body
bun run .agents/skills/entra-search/cli/src/cli.ts search -q "AI safety" --no-description --limit 40
bun run .agents/skills/entra-search/cli/src/cli.ts detail 25b71e5a-db28-43a2-84c0-1c7df875a547 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use; the only format carrying each hit's description |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "total_pages" }, "results": [...] }`;
each result carries at least `id` (the ENTRA job UUID), `title`, `company`,
`location`, `date`, `url` and `description` (missing values are `null`), plus the
permitted extras `company_slug`, `apply_url` (employer ATS page), `work_mode`,
`experience`, `employment_type`, `salary`, `source` (ATS name). `meta.total` is the
server-side match count (location included, since it is a server-side filter)
**before** the client-side `--jobage` filter; `meta.count` is what was returned
after it. When `--location` is given, `meta.location` reports what it resolved to
(`country`, `country_code`, `country_id`, `city`, `city_id`, and `also_matched`
when a duplicate city row had to be picked between). `table` and `plain` omit the
description. All errors are written to **stderr** as `{ "error": "...", "code": "..." }`
and the process exits with code `1`.

## Notes

- Data is from ENTRA's public API — no credentials required. Only account actions
  (apply/save) need a login, and this skill deliberately does not touch them: it is
  **search + detail only**. Applying happens on the employer's page (`apply_url`) or
  on ENTRA (`url`) — by the human.
- `id` in search results is the ENTRA job UUID — pass it as-is to `detail`.
- `date` is the publication date (`publishedAt`); the API has no "posted within"
  parameter, so `--jobage` is the one filter still applied client-side. Sorting is
  newest-first by default.
- `--location` is resolved before the search runs, so an uncovered market costs one
  cheap reference call and exits 1 — it never burns a `/jobs` page. ENTRA's city
  table carries junk rows harvested from ATS location strings (there is a "city"
  named Denmark filed under Spain); the resolver refuses a country name that is not
  one of the 36 rather than matching one of them.
- `salary` is present only when the employer's ATS states a salary; many postings
  don't. A `null` salary means "not stated", not "unpaid".
- `location` is rendered from ENTRA's city/country records; the occasional ATS
  location string normalizes oddly (a city paired with the wrong country has been
  observed). Treat it as a hint and confirm on the posting page.
- Result `url` links to the ENTRA posting page and carries
  `utm_source=ai-job-search` so ENTRA can measure agent traffic; drop the query
  string if you prefer a bare link. The site geo-redirects the bare
  `/vacancies/<id>` path to a country prefix.
- The API retries 429/5xx with exponential backoff, and retries **once** on a 2xx
  whose body does not parse as JSON (the live API occasionally truncates one under
  load); a second bad body exits 1 with `SEARCH_FAILED`. An unreachable API exits
  non-zero with a clear message, without retrying.
- **robots.txt disclosure.** `https://entracareers.com/robots.txt` currently carries
  `Disallow: /api/`, which is the path this CLI reads. ENTRA is the author's own
  platform and these reads are operator-sanctioned; the robots policy is being
  amended on the site side to allow the public read-only endpoints this skill uses
  (`/api/jobs`, `/api/jobs/{id}`, `/api/companies`, `/api/references/*`). Stated
  here rather than left for a reader to discover.
