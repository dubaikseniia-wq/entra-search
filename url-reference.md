# ENTRA API reference

The endpoints, parameters, and response shapes this skill depends on. This is the
file to update if the ENTRA API changes. Base URL defaults to
`https://entracareers.com/api` and is overridable via the `ENTRA_API_URL` env var;
the public site (`https://entracareers.com`, used for result links) via `ENTRA_SITE_URL`.

## Authentication

None for reads. `GET /jobs`, `GET /jobs/{id}`, `GET /companies`,
`GET /specializations` and `GET /references/*` are public; only account actions
(apply, favorites, employer endpoints) require a bearer token, and this skill does
not use them.

Verified against the live API on 2026-09-24:

| Endpoint | Status |
|----------|--------|
| `GET /jobs` | 200 |
| `GET /jobs/{id}` | 200 (404 JSON error for an unknown id) |
| `GET /companies` | 200 |
| `GET /specializations` | 200 (slug vocabulary for `--specialization`) |
| `GET /references/countries?limit=100` | 200 — 36 rows, the geography `--location` resolves against |
| `GET /references/cities?search=&countryId=` | 200 |
| `GET /jobs/search-suggestions?q=` | 200 (not used by this skill) |
| `GET /jobs/salary-ranges` | 200 (not used by this skill) |
| `GET /countries`, `GET /cities` | 404 — the reference lookups live under `/references/`, not at the root |

> **robots.txt.** `https://entracareers.com/robots.txt` disallows `/api/`. ENTRA is
> the skill author's own platform, so these read-only calls are operator-sanctioned,
> and the robots policy is being amended site-side to allow the public read
> endpoints listed above. Disclosed rather than left to be discovered.

## Envelope

Lists are `{ "data": [...], "page", "limit", "total", "totalPages" }`; a single
item is `{ "data": {...} }`. Errors are Fastify-style
`{ "statusCode": 404, "error": "Not Found", "message": "..." }` with a 4xx/5xx status.

## `GET /jobs`

Full-text + filter search over active postings, newest first by default.

Query parameters used by the skill (the full schema, `JobFiltersSchema`, accepts
more — id-keyed geography, industries, languages, benefits — none of which a CLI
user can supply without a lookup endpoint):

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `search` | `--query` / `-q` | Full-text over title/description/company (`search=stripe` matches the company). |
| `workLocation` | `--remote` | `remote` \| `hybrid` \| `office`. |
| `experienceLevel` | `--experience` | `no_experience` \| `1_3_years` \| `3_6_years` \| `6_plus_years`. |
| `employmentType` | `--employment` | `full_time` \| `part_time` \| `contract` \| `freelance` \| `internship`. |
| `specializationSlugs` | `--specialization` | Repeatable (`?specializationSlugs=a&specializationSlugs=b`), OR within the facet. Verified live: two slugs widen the count. |
| `companyId` | `--company` | UUID; the CLI resolves a slug/name via `GET /companies?search=` first. |
| `countryId` | `--location` | UUID; resolved via `GET /references/countries`. Verified live: `countryId=<US>` + `search=engineer` → 6205 of 9292. |
| `cityId` | `--location` | UUID; resolved via `GET /references/cities`. Verified live: `cityId=<San Francisco, US>` + `search=engineer` → 1188. Single value only — **there is no `cityIds`** (passing one is silently ignored and filters nothing). |
| `salaryMin` | `--salary-min` | Integer; only postings with a stated salary match (most don't). |
| `sortBy` | `--sort` | `publishedAt` (date) or `salary`; also `title`, `company` (unused). |
| `sortOrder` | (fixed `desc`) | |
| `page` | `--page` | 1-indexed. |
| `limit` | `--limit` / `-n` | 1–100 (server maximum 100). |

Not available server-side (handled client-side in `search.ts`):

- **Recency** — no `posted_within_days`; `--jobage` filters on `publishedAt` after the call.

Unknown query parameters are ignored by the API (no error, no 400), so a wrong
parameter name would filter nothing rather than fail — which is why the ones above
were each verified against a live count, and why the CLI validates its own flags
and rejects unknown ones.

## `GET /references/countries`

`?limit=100` → `{ data: [{ id, nameEn, nameAr, code, slug, flag, phoneCode }], total, page, limit }`.
**36 rows**, the complete geography ENTRA holds:

| code | nameEn | slug |
|------|--------|------|
| AE | United Arab Emirates | uae |
| AR | Argentina | argentina |
| AU | Australia | australia |
| BD | Bangladesh | bangladesh |
| BH | Bahrain | bahrain |
| BR | Brazil | brazil |
| CA | Canada | canada |
| CH | Switzerland | switzerland |
| CL | Chile | chile |
| CN | China | china |
| CY | Cyprus | cyprus |
| DE | Germany | germany |
| EG | Egypt | egypt |
| ES | Spain | spain |
| FR | France | france |
| GE | Georgia | ge |
| HK | Hong Kong | hong-kong |
| IN | India | india |
| IT | Italy | italy |
| JO | Jordan | jordan |
| JP | Japan | japan |
| KR | South Korea | south-korea |
| KW | Kuwait | kuwait |
| LB | Lebanon | lebanon |
| LK | Sri Lanka | sri-lanka |
| MX | Mexico | mexico |
| MY | Malaysia | malaysia |
| NL | Netherlands | netherlands |
| OM | Oman | oman |
| PH | Philippines | philippines |
| PK | Pakistan | pakistan |
| QA | Qatar | qatar |
| SA | Saudi Arabia | saudi-arabia |
| SG | Singapore | singapore |
| UK | United Kingdom | uk |
| US | United States | usa |

`--location` matches against `code`, `nameEn` and `slug`, case- and
punctuation-insensitively. Note `UK` (not `GB`) and the `usa` / `uae` / `ge` slugs.

## `GET /references/cities`

`?search=<text>&countryId=<uuid>&limit=<n>&page=1` → `{ data: [{ id, nameEn, nameAr, slug, countryId, timezone }], total, page, limit }`.
`search` is a case-insensitive substring match; `limit` caps at 100 (1000 is a 400).

**Known data bug:** the table holds duplicate and junk rows harvested from ATS
location strings — `San Francisco` exists under both US (`san-francisco`) and CA
(`san-francisco-2`), and there is a "city" literally named `Denmark` filed under
Spain. `cli/src/location.ts` compensates:

1. a bare token is tried as a **country** first (so `Singapore` means the country);
2. a country name the world knows but ENTRA does not cover (`Denmark`, `Poland`) is
   an error **before** the city lookup, so a junk row cannot answer for it — the set
   of world country names comes from the runtime's own `Intl.DisplayNames`, not a
   shipped list;
3. among city hits, an exact `nameEn` match wins over a substring one;
4. among exact matches, the canonical slug wins over the `-2` / `-3` duplicates;
5. `"City, Country"` scopes the lookup with `countryId`, which is the reliable form;
6. two equally canonical same-name rows are a `LOCATION_AMBIGUOUS` error listing
   both, not a coin flip.

### Job object (the fields the skill reads)

```jsonc
{
  "id": "25b71e5a-db28-43a2-84c0-1c7df875a547", // -> result.id, and detail's <id>
  "title": "Product Manager, Mobile",
  "description": "Who we are\n\nAbout Stripe\n…",   // plain text with newlines (some sources: HTML)
  "requirements": null,                             // separate requirements text, often null
  "employmentType": "full_time",
  "workLocation": "remote",                         // office | remote | hybrid
  "experienceLevel": "3_6_years",
  "salaryMin": null, "salaryMax": null,             // stated salary, usually null
  "salaryCurrency": "USD", "salaryPeriod": "monthly", // period defaults even when salary is null
  "source": "greenhouse",                           // ATS the posting was ingested from
  "externalApplyUrl": "https://stripe.com/jobs/search?gh_jid=8140438", // -> apply_url
  "isActive": true,
  "publishedAt": "2026-09-16T10:52:18.948Z",        // -> result.date
  "expiresAt": "2026-10-16T10:52:14.827Z",
  "company": { "id": "…", "name": "Stripe", "slug": "stripe", "isVerified": false },
  "specialization": { "nameEn": "Product Manager", "slug": "product-manager" },
  "country": { "nameEn": "United States", "slug": "usa", "flag": "🇺🇸" }, // no ISO code field
  "city": { "nameEn": "New York City", "slug": "new-york-city" }
}
```

`country` carries no ISO code; the public posting URL is built as
`https://entracareers.com/vacancies/<id>` (the site geo-redirects to a country
prefix, any prefix resolves).

## `GET /jobs/{id}`

A single job by UUID, same object in `data`. An expired posting is still served
(`isActive: false`); an unknown id is a 404 JSON error, which the skill maps to
`NOT_FOUND` on stderr.

## `GET /companies`

`?search=<text>&limit=<n>&page=1` → `{ data: [{ id, name, slug, isVerified, … }], total, page, limit }`.
The skill uses it only to resolve `--company` (exact slug/name match preferred,
otherwise the first row). Verified live: `search=spacex` → one row, slug `spacex`.

## `GET /specializations`

The specialization vocabulary (`slug`, `nameEn`) behind `--specialization`. The
skill does not call it programmatically; it is the discovery source the SKILL.md
points users to.

## Parsing notes

- Responses are JSON, so there is no HTML card parsing. Descriptions are plain text
  for most ATS sources; `cleanHtml` (`cli/src/helpers.ts`) strips tags and decodes
  entities for the ones that arrive as HTML and passes plain text through with
  whitespace normalized.
- Fetch uses `Mozilla/5.0 (compatible; entra-cli/1.0)`, `Accept: application/json`,
  a 15 s timeout, and exponential backoff with jitter on 429/5xx (max 6 retries). A
  connection error (API unreachable) fails fast with a clear message — no retry —
  which is the graceful-degradation contract.
