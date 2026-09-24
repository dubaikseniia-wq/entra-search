import { afterEach, describe, expect, test } from "bun:test";
import { apiGet } from "../src/helpers";

// The live API has been observed returning an occasional 200 with a truncated,
// non-JSON body (reported upstream as a transient `SEARCH_FAILED: unparseable
// response body`). One retry absorbs it; a second bad body still fails loudly.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sequence(bodies: string[]): { calls: () => number } {
  let i = 0;
  globalThis.fetch = (async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls: () => i };
}

describe("apiGet unparseable body", () => {
  test("retries once and succeeds when the repeat parses", async () => {
    const good = JSON.stringify({ data: [], page: 1, limit: 1, total: 0, totalPages: 0 });
    const seq = sequence(["<html>502 Bad Gateway</html>", good]);
    const body = await apiGet<{ total: number }>("/jobs?limit=1");
    expect(body?.total).toBe(0);
    expect(seq.calls()).toBe(2);
  });

  test("a second unparseable body throws the original error, and only once is retried", async () => {
    const seq = sequence(["not json", "still not json"]);
    await expect(apiGet("/jobs?limit=1")).rejects.toThrow("unparseable response body");
    expect(seq.calls()).toBe(2);
  });
});
