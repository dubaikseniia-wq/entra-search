# entra-search

Portal skill for **[ENTRA](https://entracareers.com)**: AI, software, data and
engineering jobs ingested straight from employers' own applicant-tracking systems
(Greenhouse, Lever, Ashby, …) rather than reposted or scraped — so every hit is a
role the employer is currently running in its own ATS, with the employer's apply
link attached.

Matches the [ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
`/add-portal` contract, so `/scrape` auto-discovers a folder named `*-search`.

**Zero runtime dependencies** (bun + `fetch`). MIT. No API key, no signup — reads
on ENTRA's public JSON API are unauthenticated.

## Honest notes, up front

- **First-party.** I run ENTRA. This skill reads my own platform's public API, so
  the automated read access is operator-sanctioned rather than merely tolerated.
  Read the rest of this list as an interested party's disclosure, not a review.
- **Result links carry tracking.** Each result's `url` is
  `https://entracareers.com/vacancies/<id>?utm_source=ai-job-search&utm_medium=agent`,
  which is how ENTRA measures agent traffic. `apply_url` — the employer's own ATS
  page — carries nothing of ours. Drop the query string if you'd rather not send it;
  the bare link resolves.
- **What it covers.** Verified ATS-sourced AI & tech postings. ENTRA's geography
  records span **36 countries** (list below), and `--location` is limited to them.
- **What it does not do.** Search and detail only. It never applies, never saves,
  never logs in, never writes. Applying happens on the employer's page or on ENTRA,
  by a human.
- **robots.txt.** `https://entracareers.com/robots.txt` currently carries
  `Disallow: /api/`, the path this CLI reads. As the operator I sanction these
  read-only calls, and the robots policy is being amended site-side to allow the
  public read endpoints the skill uses. Saying so here rather than leaving it to be
  found.
- **Hosted service.** ENTRA is not self-hostable. `ENTRA_API_URL` repoints the CLI
  at a staging instance, `ENTRA_SITE_URL` at a different public site for the links;
  no other environment variable is read, and no other host is contacted.

## Install into a local ai-job-search checkout

```bash
git clone https://github.com/dubaikseniia-wq/entra-search.git \
  "/path/to/ai-job-search/.agents/skills/entra-search"

cd /path/to/ai-job-search
# optional, only installs TypeScript dev types
cd .agents/skills/entra-search/cli && bun install && cd ../../../..

# smoke
bun run .agents/skills/entra-search/cli/src/cli.ts search -q "machine learning engineer" --limit 5 --format table
```

`/scrape` picks up any `.agents/skills/*-search/SKILL.md` automatically. No other
wiring. Set `enabled: false` in `SKILL.md`'s frontmatter to keep it installed but
skipped.

If your fork's `.claude/settings.json` gates Bash permissions, add the one line
`"Bash(bun run .agents/skills/entra-search/cli/src/cli.ts:*)"` — and the matching
`ALLOWED_PERMISSIONS` entry in `tools/security_guards.py`, which upstream's guard
requires alongside it.

Windows (PowerShell):

```powershell
git clone https://github.com/dubaikseniia-wq/entra-search.git "D:\path\to\ai-job-search\.agents\skills\entra-search"
```

## Examples

```bash
cd .agents/skills/entra-search/cli

# Remote ML roles
bun run src/cli.ts search -q "machine learning engineer" --remote --limit 10 --format table

# A whole country
bun run src/cli.ts search -q engineer --location US --limit 5 --format table

# One city, disambiguated (ENTRA holds a San Francisco in both US and CA)
bun run src/cli.ts search -q engineer --location "San Francisco, US" --limit 5 --format table

# Everything SpaceX posted in the last 14 days, highest salary first
bun run src/cli.ts search --company spacex --jobage 14 --sort salary --format table

# Cheap discovery pass, then read one posting
bun run src/cli.ts search -q "AI safety" --no-description --limit 40
bun run src/cli.ts detail 25b71e5a-db28-43a2-84c0-1c7df875a547 --format plain
```

Search results already carry each posting's **full description**, so a search of 20
roles is one request, not 1 + 20. Do not loop `detail` over search hits.

## `--location`: a real API filter, and its limits

ENTRA keys geography by UUID, so the CLI resolves your text to a `countryId` and,
where it can, a `cityId` — through `GET /api/references/countries` and
`GET /api/references/cities` — and passes those as server-side filters, the same
way `--company` resolves a company slug. It is not a filter over the page that was
fetched.

Accepted: a country code (`US`, `AE`, `UK`), a country name (`United States`,
`Germany`), a bare city (`Berlin`), or `"City, Country"` (`"San Francisco, US"`).
Case and punctuation are ignored. A bare token is tried as a country first, so
`--location Singapore` means the country.

The 36 countries ENTRA holds geography for:

```
AE  AR  AU  BD  BH  BR  CA  CH  CL  CN  CY  DE  EG  ES  FR  GE  HK  IN
IT  JO  JP  KR  KW  LB  LK  MX  MY  NL  OM  PH  PK  QA  SA  SG  UK  US
```

(live: `GET https://entracareers.com/api/references/countries?limit=100`. Note `UK`,
not `GB`.)

Anything outside them exits `1` with JSON on stderr naming the supported codes,
rather than quietly returning an empty page:

```console
$ bun run src/cli.ts search -q engineer --location Denmark
{"error":"--location \"Denmark\": Denmark is a country ENTRA does not cover. Its geography spans 36 countries — supported country codes: AE, AR, AU, …","code":"LOCATION_NOT_FOUND"}
$ echo $?
1
```

Two known data quirks this handles rather than hides: ENTRA's city table carries
duplicate rows (`san-francisco` under US, `san-francisco-2` under CA — the canonical
slug wins, and the other is reported in `meta.location.also_matched`) and junk rows
harvested from ATS location strings (there is a "city" named Denmark filed under
Spain — a world country name that ENTRA does not cover is rejected *before* the city
lookup, so it cannot answer for one). A city name that is genuinely ambiguous exits
`1` with `LOCATION_AMBIGUOUS` listing the candidates instead of guessing.

Remote roles in uncovered markets are still reachable: use `--remote` with no
`--location`.

## Output

`search` emits `{ "meta": { count, page, total, total_pages }, "results": [...] }`.
Each result carries `id`, `title`, `company`, `location`, `date`, `url`,
`description` (missing values are `null`, never omitted), plus the permitted extras
`company_slug`, `apply_url`, `work_mode`, `experience`, `employment_type`, `salary`,
`source` (the ATS the posting came from). With `--location`, `meta.location` reports
what was resolved. `table` and `plain` omit descriptions.

All errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit `1`.
Codes: `BAD_ARG`, `BAD_CMD`, `BAD_ID`, `UNKNOWN_FLAG`, `NOT_FOUND`,
`LOCATION_NOT_FOUND`, `LOCATION_AMBIGUOUS`, `SEARCH_FAILED`, `DETAIL_FAILED`,
`INTERNAL_ERROR`.

## API it hits

- Search: `GET https://entracareers.com/api/jobs?search=&countryId=&cityId=&workLocation=&…`
- Detail: `GET https://entracareers.com/api/jobs/<uuid>`
- Company resolution: `GET https://entracareers.com/api/companies?search=`
- Geography: `GET https://entracareers.com/api/references/countries?limit=100`,
  `GET https://entracareers.com/api/references/cities?search=&countryId=`
- User-Agent: `Mozilla/5.0 (compatible; entra-cli/1.0)`
- Override: `ENTRA_API_URL=http://localhost:3001/api bun run src/cli.ts search -q engineer`

Retries 429/5xx with exponential backoff and jitter (max 6), retries **once** on a
2xx whose body does not parse as JSON, fails fast without retrying when the API is
unreachable. 15 s request timeout. See `url-reference.md` for every parameter, the
full country table and the response shapes.

## Tests

Offline — every test stubs `fetch`, nothing leaves the machine.

```bash
cd cli
bun install          # optional, dev type defs only
bun run typecheck    # tsc --noEmit
bun test             # 59 tests
```

Covered: the `{meta, results}` envelope and required fields, flag→query-parameter
mapping, unknown-flag rejection, argument validation, company resolution, the
location resolver (country code / country name / bare city / `"City, Country"` /
uncovered country / junk-row guard / duplicate disambiguation / ambiguity error),
the client-side `--jobage` window, HTML cleaning, salary and id parsing, 5xx
backoff, request timeout, and the unparseable-body retry.

## Attribution

The portal-skill command contract (`search` / `detail`, `--format json|table|plain`,
JSON errors on stderr with exit 1, exponential backoff on 429/5xx, zero runtime
dependencies) follows the specification published in
[ai-job-search](https://github.com/MadsLorentzen/ai-job-search) by Mads Lorentzen,
MIT License, Copyright (c) 2026 Mads Lorentzen. This skill is MIT,
Copyright (c) 2026 Ksenia Kurdiukova (ENTRA).

It tracks upstream as a **skill folder only** — it vendors no workflow specs and
modifies no core files, so it drops into the current `master` and stays compatible
with upstream improvements.

## History

Originally offered upstream as
[PR #491](https://github.com/MadsLorentzen/ai-job-search/pull/491). The maintainer
closed it on policy grounds rather than quality — hosted-service portals open a
discussion before a PR, and a new portal earns core promotion on observed demand —
and pointed at this shape instead: a standalone repo, listed from
[Discussion #78](https://github.com/MadsLorentzen/ai-job-search/discussions/78).
The `--location` bug he found in that review (a client-side substring filter that
only ever saw the fetched page) is what the resolver above replaces; the transient
`unparseable response body` he hit is what the single retry absorbs. The third
thing he flagged — `robots.txt` disallowing `/api/` — is on the site side and is
still open; it is disclosed above rather than quietly left.

Posted to Discussion #78 on 24 Sep 2026:
https://github.com/MadsLorentzen/ai-job-search/discussions/78#discussioncomment-18586225
