// --location resolution.
//
// ENTRA keys geography by UUID server-side: `GET /jobs` accepts `countryId` and
// `cityId` (single UUIDs — there is no `cityIds`, and an unknown query parameter
// is silently ignored, so a wrong guess would filter nothing). This module turns
// the user's free text into those ids the same way `--company` resolves a slug,
// via the public reference endpoints:
//
//   GET /references/countries?limit=100        -> the 36 countries ENTRA covers
//   GET /references/cities?search=&countryId=  -> cities within them
//
// Anything it cannot resolve raises a LocationError, which the caller reports on
// stderr with exit 1. Silently returning zero rows for an uncovered market (the
// old client-side substring filter's behaviour) is the bug this replaces.

import { apiGet, type ListEnvelope } from "./helpers.js"

/** A country row from `GET /references/countries`. */
export interface EntraCountry {
  id: string
  nameEn: string
  code: string
  slug: string
}

/** A city row from `GET /references/cities`. */
export interface EntraCity {
  id: string
  nameEn: string
  slug: string
  countryId: string
}

/** The ids a resolved `--location` contributes to the `/jobs` query, plus labels for `meta`. */
export interface ResolvedLocation {
  input: string
  countryId: string
  cityId?: string
  country: { id: string; code: string; name: string }
  city?: { id: string; name: string }
  /** Other ENTRA cities the input also matched, when a duplicate row forced a pick. */
  alternatives?: string[]
}

/** A `--location` that could not be turned into ENTRA ids. Carries the stderr `code`. */
export class LocationError extends Error {
  readonly code: string
  constructor(message: string, code: "LOCATION_NOT_FOUND" | "LOCATION_AMBIGUOUS" = "LOCATION_NOT_FOUND") {
    super(message)
    this.name = "LocationError"
    this.code = code
  }
}

/** Fold to a comparable key: lowercase, letters and digits only ("United-Kingdom" -> "unitedkingdom"). */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * Every ISO 3166-1 alpha-2 region name the runtime's own ICU data knows, folded
 * for comparison. Built with `Intl.DisplayNames` — no dependency and no shipped
 * country list to go stale.
 *
 * This exists because ENTRA's city table contains junk rows harvested from ATS
 * location strings: there is a "city" literally named Denmark (filed under Spain)
 * and another under the UK. Without this guard `--location Denmark` resolves to
 * one of them and returns an empty page, which is exactly the silent zero this
 * whole module replaces. A country ENTRA does not cover must say so.
 */
let worldCountries: Set<string> | null = null
function worldCountryKeys(): Set<string> {
  if (worldCountries) return worldCountries
  const set = new Set<string>()
  let display: Intl.DisplayNames | undefined
  try {
    display = new Intl.DisplayNames(["en"], { type: "region" })
  } catch {
    worldCountries = set
    return set
  }
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      let name: string | undefined
      try {
        name = display.of(code)
      } catch {
        continue
      }
      if (!name || name === code) continue
      set.add(squash(name))
    }
  }
  worldCountries = set
  return set
}

/** Is this free text the name of a country somewhere in the world? */
export function isWorldCountryName(text: string): boolean {
  return worldCountryKeys().has(squash(text))
}

/** The duplicate rows in ENTRA's city table carry a numeric slug suffix ("san-francisco-2"). */
function isCanonicalSlug(slug: string): boolean {
  return !/-\d+$/.test(slug ?? "")
}

export async function fetchCountries(): Promise<EntraCountry[]> {
  const env = await apiGet<ListEnvelope<EntraCountry>>("/references/countries?limit=100")
  return env?.data ?? []
}

async function fetchCities(search: string, countryId?: string): Promise<EntraCity[]> {
  const q = new URLSearchParams({ search, limit: "100", page: "1" })
  if (countryId) q.set("countryId", countryId)
  const env = await apiGet<ListEnvelope<EntraCity>>(`/references/cities?${q.toString()}`)
  return env?.data ?? []
}

/** Match free text against a country's ISO-ish code, English name or slug (case/punctuation insensitive). */
export function matchCountry(countries: EntraCountry[], text: string): EntraCountry | undefined {
  const wanted = squash(text)
  if (!wanted) return undefined
  return countries.find((c) => squash(c.code) === wanted || squash(c.nameEn) === wanted || squash(c.slug) === wanted)
}

/** "AE, AR, AU, …" — the coverage list every location error ends with. */
export function supportedCodes(countries: EntraCountry[]): string {
  return countries
    .map((c) => c.code)
    .filter(Boolean)
    .sort()
    .join(", ")
}

function label(city: EntraCity, countries: EntraCountry[]): string {
  const country = countries.find((c) => c.id === city.countryId)
  return country ? `${city.nameEn}, ${country.code}` : city.nameEn
}

interface CityPick {
  city: EntraCity
  alternatives: string[]
}

/**
 * Pick one city row for `text`. ENTRA's city table has duplicate and junk rows
 * (a known data bug), so: prefer an exact `nameEn` match; within those prefer the
 * canonical slug (the duplicates are suffixed `-2`, `-3`, …); a still-ambiguous
 * set is an error rather than a coin flip.
 */
async function resolveCity(
  text: string,
  countries: EntraCountry[],
  input: string,
  country?: EntraCountry,
): Promise<CityPick> {
  const rows = (await fetchCities(text, country?.id)).filter((c) => !country || c.countryId === country.id)

  const wanted = squash(text)
  const exact = rows.filter((c) => squash(c.nameEn) === wanted)
  const pool = exact.length > 0 ? exact : rows

  if (pool.length === 0) {
    if (country) {
      throw new LocationError(
        `--location "${input}": ENTRA has no city named "${text}" in ${country.nameEn} (${country.code}). ` +
          `Use --location ${country.code} to search the whole country, or list the cities ENTRA holds at ` +
          `GET https://entracareers.com/api/references/cities?countryId=${country.id}&search=${encodeURIComponent(text)}`,
      )
    }
    throw new LocationError(
      `--location "${input}": no ENTRA country or city matches it. ENTRA's geography covers ${countries.length} countries — ` +
        `pass a country code, a country name, a city inside one of them, or "City, Country". ` +
        `Supported country codes: ${supportedCodes(countries)}.`,
    )
  }

  if (pool.length === 1) return { city: pool[0], alternatives: [] }

  const canonical = pool.filter((c) => isCanonicalSlug(c.slug))
  const alternatives = pool.map((c) => label(c, countries))
  if (canonical.length === 1) return { city: canonical[0], alternatives: alternatives.filter((a) => a !== label(canonical[0], countries)) }

  throw new LocationError(
    `--location "${input}" matches ${pool.length} ENTRA cities (${alternatives.join("; ")}). ` +
      `Disambiguate with "City, <country code>", e.g. --location "${pool[0].nameEn}, ${
        countries.find((c) => c.id === pool[0].countryId)?.code ?? "US"
      }".`,
    "LOCATION_AMBIGUOUS",
  )
}

/**
 * Turn `--location` into ENTRA ids.
 *
 * - `US`, `usa`, `United States`  -> countryId
 * - `Berlin`                      -> cityId (+ its countryId)
 * - `San Francisco, US`           -> countryId + cityId, country disambiguating the duplicate rows
 * - `Denmark`                     -> LocationError listing the supported country codes
 *
 * A bare token is tried as a country first: `--location Singapore` should mean
 * the country, which is a superset of the city of the same name.
 */
export async function resolveLocation(raw: string): Promise<ResolvedLocation> {
  const input = raw.trim()
  if (!input) throw new LocationError("--location needs a value, e.g. --location US or --location \"Berlin, DE\"")

  const countries = await fetchCountries()
  if (countries.length === 0) {
    throw new LocationError("could not load ENTRA's country list from /references/countries — cannot resolve --location")
  }

  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // "City, Country": the trailing part names the country, the rest the city.
  if (parts.length >= 2) {
    const countryText = parts[parts.length - 1]
    const cityText = parts.slice(0, -1).join(", ")
    const country = matchCountry(countries, countryText)
    if (!country) {
      throw new LocationError(
        `--location "${input}": "${countryText}" is not one of the ${countries.length} countries ENTRA covers. ` +
          `Supported country codes: ${supportedCodes(countries)}.`,
      )
    }
    const { city, alternatives } = await resolveCity(cityText, countries, input, country)
    return {
      input,
      countryId: country.id,
      cityId: city.id,
      country: { id: country.id, code: country.code, name: country.nameEn },
      city: { id: city.id, name: city.nameEn },
      ...(alternatives.length ? { alternatives } : {}),
    }
  }

  const country = matchCountry(countries, input)
  if (country) {
    return { input, countryId: country.id, country: { id: country.id, code: country.code, name: country.nameEn } }
  }

  // A country name that is not one of ENTRA's is an outright miss, checked before
  // the city lookup so a junk city row of the same name cannot answer for it.
  if (isWorldCountryName(input)) {
    throw new LocationError(
      `--location "${input}": ${input} is a country ENTRA does not cover. Its geography spans ${countries.length} countries — ` +
        `supported country codes: ${supportedCodes(countries)}. ` +
        `For a city, pass the city itself or "City, Country".`,
    )
  }

  const { city, alternatives } = await resolveCity(input, countries, input)
  const cityCountry = countries.find((c) => c.id === city.countryId)
  if (!cityCountry) {
    throw new LocationError(
      `--location "${input}" resolved to a city ENTRA holds outside its ${countries.length} covered countries. ` +
        `Supported country codes: ${supportedCodes(countries)}.`,
    )
  }
  return {
    input,
    countryId: cityCountry.id,
    cityId: city.id,
    country: { id: cityCountry.id, code: cityCountry.code, name: cityCountry.nameEn },
    city: { id: city.id, name: city.nameEn },
    ...(alternatives.length ? { alternatives } : {}),
  }
}
