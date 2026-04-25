import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * End-to-end coverage for the /api/auth/email-deliveries?format=csv
 * Content-Disposition filename contract.
 *
 * The CSV export from the email-delivery-health page is the audit
 * artifact compliance reviewers rely on, and the route's filename
 * branch (server/auth/local-routes.ts, ~lines 706-755) is doing two
 * jobs at once:
 *
 *   (a) Reflect the chosen window in the filename so reviewers can
 *       pull "Jan 2025" and "Feb 2025" side-by-side without one
 *       overwriting the other in their Downloads folder, and
 *   (b) Refuse to splice anything that isn't a strict YYYY-MM-DD into
 *       Content-Disposition — otherwise an attacker (or a careless
 *       admin pasting an ISO timestamp) could smuggle a CRLF or quote
 *       through the header.
 *
 * Until this spec landed neither half of that contract had a regression
 * test. A revert that swapped the strict /^\d{4}-\d{2}-\d{2}$/ guard
 * for a more permissive matcher, or that accidentally always wrote the
 * today-stamped fallback, would only surface when a human noticed
 * duplicate-named files (or, in the worst case, never).
 *
 * The spec piggybacks on the dedicated workspace + dedicated owner
 * provisioned by `email-delivery-alerts.setup.ts`. That setup already
 * provides an owner storage state and a known company id — exactly
 * what we need for an authenticated CSV pull. The route only reads the
 * filter parameters, so we don't have to seed any delivery rows; an
 * empty result set is a perfectly valid CSV and exercises the same
 * filename branch.
 */

const OWNER_STORAGE = ".playwright/edap-owner.json";

interface SharedFixture {
  companyId: number;
  ownerUserId: string;
}

function readSharedFixture(): SharedFixture {
  const fixturePath = path.resolve(
    ".playwright/email-delivery-alerts-fixture.json",
  );
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Missing ${fixturePath}. Run the email-delivery-alerts-setup project ` +
        `first (it persists the dedicated company id this spec relies on).`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Partial<
    SharedFixture
  >;
  if (!raw.companyId || !raw.ownerUserId) {
    throw new Error(
      `email-delivery-alerts-fixture.json missing companyId or ownerUserId`,
    );
  }
  return { companyId: raw.companyId, ownerUserId: raw.ownerUserId };
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("email-delivery CSV export filename @csv-export", () => {
  test.use({ storageState: OWNER_STORAGE });

  let companyId: number;
  test.beforeAll(() => {
    companyId = readSharedFixture().companyId;
  });

  // Pin every call to the dedicated workspace via x-company-id. The
  // dedicated owner only holds one membership (the setup defensively
  // deletes any sibling memberships) so the server's "first
  // membership" fallback would land here too — but the explicit
  // header keeps the intent visible and matches the pinning style in
  // `email-delivery-alerts.spec.ts`.
  function headers(): Record<string, string> {
    return { "x-company-id": String(companyId) };
  }

  test("windowed filename: both from and to are valid YYYY-MM-DD", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/auth/email-deliveries?format=csv&from=2025-01-01&to=2025-01-31",
      { headers: headers() },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers()["content-disposition"]).toBe(
      'attachment; filename="email-delivery-2025-01-01_to_2025-01-31.csv"',
    );
  });

  test("today-stamped fallback when neither from nor to is provided", async ({
    request,
  }) => {
    // Capture the date stamp on either side of the request so the
    // assertion still holds if the request happens to straddle a UTC
    // midnight tick. Either bound is acceptable.
    const before = todayStamp();
    const res = await request.get("/api/auth/email-deliveries?format=csv", {
      headers: headers(),
    });
    const after = todayStamp();
    expect(res.status()).toBe(200);
    const cd = res.headers()["content-disposition"];
    expect([
      `attachment; filename="email-delivery-${before}.csv"`,
      `attachment; filename="email-delivery-${after}.csv"`,
    ]).toContain(cd);
  });

  test("non-YYYY-MM-DD inputs do not appear in the filename (header-injection guard)", async ({
    request,
  }) => {
    // Two probes layered into one request:
    //   * `from` carries a CRLF + quote injection payload that, if not
    //     filtered, would let the attacker close the filename and
    //     splice arbitrary header content (or even a second header)
    //     into the response.
    //   * `to` carries a "loose" date format (single-digit month/day)
    //     that the strict /^\d{4}-\d{2}-\d{2}$/ guard must still
    //     reject — catches a regression that swaps in a more
    //     permissive matcher.
    const malicious = '2025-01-01"; injected="x\r\nX-Evil: yes';
    const looseFmt = "2025-1-1";
    const url =
      "/api/auth/email-deliveries?format=csv" +
      `&from=${encodeURIComponent(malicious)}` +
      `&to=${encodeURIComponent(looseFmt)}`;

    const before = todayStamp();
    const res = await request.get(url, { headers: headers() });
    const after = todayStamp();

    expect(res.status()).toBe(200);
    const cd = res.headers()["content-disposition"];
    // Both inputs were rejected, so the route falls through to the
    // today-stamped fallback — matching the "no window" branch above.
    expect([
      `attachment; filename="email-delivery-${before}.csv"`,
      `attachment; filename="email-delivery-${after}.csv"`,
    ]).toContain(cd);

    // Belt-and-braces: the literal injection payload and the loose
    // date format must not appear anywhere in Content-Disposition.
    // These are stronger negative assertions than just checking the
    // exact filename — they catch a regression where a future
    // refactor accidentally interpolates the raw query value into
    // some other part of the header.
    expect(cd).not.toContain("injected");
    expect(cd).not.toContain("X-Evil");
    expect(cd).not.toContain("2025-1-1");

    // The server must not have surfaced the injected header either —
    // a smuggled CRLF would let the attacker append response headers
    // that weren't on our allow-list.
    expect(res.headers()["x-evil"]).toBeUndefined();
  });
});
