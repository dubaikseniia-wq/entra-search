import { afterEach, describe, expect, test } from "bun:test";
import { LocationError, isWorldCountryName, matchCountry, resolveLocation, type EntraCity, type EntraCountry } from "../src/location";
import { runSearch, type SearchOpts } from "../src/commands/search";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

// A trimmed stand-in for ENTRA's 36 covered countries.
const COUNTRIES: EntraCountry[] = [
  { id: "c-us", nameEn: "United States", code: "US", slug: "usa" },
  { id: "c-ca", nameEn: "Canada", code: "CA", slug: "canada" },
  { id: "c-de", nameEn: "Germany", code: "DE", slug: "germany" },
  { id: "c-ae", nameEn: "United Arab Emirates", code: "AE", slug: "uae" },
];

// ENTRA's city table carries duplicate and junk rows (a known data bug): the
// duplicate of a city gets a numeric slug suffix. Portland is the harder case -
// two exact matches, both with canonical slugs, which must not be a coin flip.
const CITIES: EntraCity[] = [
  { id: "city-sf-us", nameEn: "San Francisco", slug: "san-francisco", countryId: "c-us" },
  { id: "city-sf-ca", nameEn: "San Francisco", slug: "san-francisco-2", countryId: "c-ca" },
  { id: "city-sf-bay", nameEn: "San Francisco Bay area", slug: "san-francisco-bay-area", countryId: "c-ca" },
  { id: "city-berlin", nameEn: "Berlin", slug: "berlin", countryId: "c-de" },
  { id: "city-portland-or", nameEn: "Portland", slug: "portland-oregon", countryId: "c-us" },
  { id: "city-portland-me", nameEn: "Portland", slug: "portland-maine", countryId: "c-us" },
  // A junk row: ENTRA's live table has one of these for Denmark, filed under Spain.
  { id: "city-junk-denmark", nameEn: "Denmark", slug: "denmark", countryId: "c-de" },
];

function captureStdout(): { get: () => string } {
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { get: () => buf };
}

function captureStderr(): { get: () => string } {
  let buf = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  return { get: () => buf };
}

/** Stub the reference endpoints and /jobs; every requested URL is recorded. */
function mockApi(jobs: unknown[] = []): { urls: () => string[] } {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(href);
    const url = new URL(href);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    if (url.pathname.endsWith("/references/countries")) {
      return json({ data: COUNTRIES, total: COUNTRIES.length, page: 1, limit: 100 });
    }
    if (url.pathname.endsWith("/references/cities")) {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const countryId = url.searchParams.get("countryId");
      const rows = CITIES.filter(
        (c) => c.nameEn.toLowerCase().includes(search) && (!countryId || c.countryId === countryId),
      );
      return json({ data: rows, total: rows.length, page: 1, limit: 100 });
    }
    if (url.pathname.endsWith("/jobs")) {
      return json({ data: jobs, page: 1, limit: 25, total: jobs.length, totalPages: 1 });
    }
    return new Response(JSON.stringify({ statusCode: 404, error: "Not Found" }), { status: 404 });
  }) as typeof fetch;
  return { urls: () => requested };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

const searchOpts: SearchOpts = {
  jobage: 9999,
  page: 1,
  limit: 25,
  format: "json",
  includeDescription: true,
  specializations: [],
  sort: "date",
};

describe("isWorldCountryName", () => {
  test("knows country names from the runtime's own ICU data, not a shipped list", () => {
    expect(isWorldCountryName("Denmark")).toBe(true);
    expect(isWorldCountryName("denmark")).toBe(true);
    expect(isWorldCountryName("Poland")).toBe(true);
    expect(isWorldCountryName("Copenhagen")).toBe(false);
    expect(isWorldCountryName("San Francisco")).toBe(false);
  });
});

describe("matchCountry", () => {
  test("matches on code, English name and slug, case- and punctuation-insensitively", () => {
    expect(matchCountry(COUNTRIES, "US")?.id).toBe("c-us");
    expect(matchCountry(COUNTRIES, "us")?.id).toBe("c-us");
    expect(matchCountry(COUNTRIES, "united states")?.id).toBe("c-us");
    expect(matchCountry(COUNTRIES, "usa")?.id).toBe("c-us");
    expect(matchCountry(COUNTRIES, "United-Arab-Emirates")?.id).toBe("c-ae");
    expect(matchCountry(COUNTRIES, "Denmark")).toBeUndefined();
  });
});

describe("resolveLocation", () => {
  test("a country code resolves to countryId alone and never touches /references/cities", async () => {
    const mock = mockApi();
    const loc = await resolveLocation("US");
    expect(loc.countryId).toBe("c-us");
    expect(loc.cityId).toBeUndefined();
    expect(loc.country.code).toBe("US");
    expect(mock.urls().some((u) => u.includes("/references/cities"))).toBe(false);
  });

  test("a country name resolves the same way", async () => {
    mockApi();
    expect((await resolveLocation("germany")).countryId).toBe("c-de");
    expect((await resolveLocation("United Arab Emirates")).countryId).toBe("c-ae");
  });

  test("a bare city resolves to its cityId and its country", async () => {
    mockApi();
    const loc = await resolveLocation("Berlin");
    expect(loc.cityId).toBe("city-berlin");
    expect(loc.countryId).toBe("c-de");
    expect(loc.city?.name).toBe("Berlin");
  });

  test('"City, Country" scopes the city lookup to that country', async () => {
    const mock = mockApi();
    const loc = await resolveLocation("San Francisco, CA");
    expect(loc.cityId).toBe("city-sf-ca"); // the Canadian duplicate, because the user said so
    expect(loc.countryId).toBe("c-ca");
    const citiesUrl = mock.urls().find((u) => u.includes("/references/cities"))!;
    expect(new URL(citiesUrl).searchParams.get("countryId")).toBe("c-ca");
  });

  test("a duplicated city with no country picks the canonical slug and reports the alternative", async () => {
    mockApi();
    const loc = await resolveLocation("San Francisco");
    // "San Francisco Bay area" is a substring hit but not an exact name match,
    // and "san-francisco-2" is the duplicate row - the canonical slug wins.
    expect(loc.cityId).toBe("city-sf-us");
    expect(loc.countryId).toBe("c-us");
    expect(loc.alternatives).toEqual(["San Francisco, CA"]);
  });

  test("two equally canonical duplicates are an explicit LOCATION_AMBIGUOUS error", async () => {
    mockApi();
    const err = await resolveLocation("Portland").catch((e) => e as LocationError);
    expect(err).toBeInstanceOf(LocationError);
    expect((err as LocationError).code).toBe("LOCATION_AMBIGUOUS");
    expect((err as LocationError).message).toContain("Portland, US");
  });

  test("an uncovered country errors with the supported country codes", async () => {
    mockApi();
    const err = await resolveLocation("Denmark").catch((e) => e as LocationError);
    expect(err).toBeInstanceOf(LocationError);
    expect((err as LocationError).code).toBe("LOCATION_NOT_FOUND");
    expect((err as LocationError).message).toContain("supported country codes: AE, CA, DE, US");
  });

  test("an uncovered country beats a junk city row of the same name", async () => {
    // ENTRA's live city table really does hold a "city" named Denmark under
    // Spain (and another under the UK) - harvested from an ATS location string.
    // Resolving to it would hand back an empty page instead of an error.
    const mock = mockApi();
    const err = await resolveLocation("Denmark").catch((e) => e as LocationError);
    expect((err as LocationError).message).toContain("Denmark is a country ENTRA does not cover");
    expect(mock.urls().some((u) => u.includes("/references/cities"))).toBe(false);
  });

  test("a city that is not a country name still goes to the city lookup", async () => {
    const mock = mockApi();
    const err = await resolveLocation("Copenhagen").catch((e) => e as LocationError);
    expect((err as LocationError).code).toBe("LOCATION_NOT_FOUND");
    expect(mock.urls().some((u) => u.includes("/references/cities"))).toBe(true);
  });

  test('"City, UncoveredCountry" names the country that is missing', async () => {
    mockApi();
    const err = await resolveLocation("Copenhagen, Denmark").catch((e) => e as LocationError);
    expect((err as LocationError).code).toBe("LOCATION_NOT_FOUND");
    expect((err as LocationError).message).toContain('"Denmark" is not one of the 4 countries');
  });

  test("an unknown city inside a covered country suggests the country-wide search", async () => {
    mockApi();
    const err = await resolveLocation("Nowheresville, US").catch((e) => e as LocationError);
    expect((err as LocationError).code).toBe("LOCATION_NOT_FOUND");
    expect((err as LocationError).message).toContain("--location US");
  });
});

describe("runSearch with --location", () => {
  test("passes countryId and cityId to /jobs as real API filters", async () => {
    const mock = mockApi([]);
    captureStdout();
    const code = await runSearch({ ...searchOpts, query: "engineer", location: "San Francisco, US" });
    expect(code).toBe(0);
    const jobsUrl = mock.urls().find((u) => new URL(u).pathname.endsWith("/jobs"))!;
    const p = new URL(jobsUrl).searchParams;
    expect(p.get("countryId")).toBe("c-us");
    expect(p.get("cityId")).toBe("city-sf-us");
    expect(p.get("search")).toBe("engineer");
  });

  test("a country-only location sends countryId and no cityId", async () => {
    const mock = mockApi([]);
    captureStdout();
    await runSearch({ ...searchOpts, location: "US" });
    const p = new URL(mock.urls().find((u) => new URL(u).pathname.endsWith("/jobs"))!).searchParams;
    expect(p.get("countryId")).toBe("c-us");
    expect(p.has("cityId")).toBe(false);
  });

  test("reports the resolution in meta.location", async () => {
    mockApi([]);
    const out = captureStdout();
    await runSearch({ ...searchOpts, location: "Berlin" });
    const meta = JSON.parse(out.get()).meta;
    expect(meta.location).toEqual({
      input: "Berlin",
      country: "Germany",
      country_code: "DE",
      country_id: "c-de",
      city: "Berlin",
      city_id: "city-berlin",
    });
  });

  test("an unresolvable location exits 1 with JSON on stderr and never queries /jobs", async () => {
    const mock = mockApi([]);
    captureStdout();
    const err = captureStderr();
    const code = await runSearch({ ...searchOpts, query: "engineer", location: "Denmark" });
    expect(code).toBe(1);
    const parsed = JSON.parse(err.get());
    expect(parsed.code).toBe("LOCATION_NOT_FOUND");
    expect(parsed.error).toContain("supported country codes: AE, CA, DE, US");
    expect(mock.urls().some((u) => new URL(u).pathname.endsWith("/jobs"))).toBe(false);
  });
});
