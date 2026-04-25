import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #196 — the magic-bytes gate on the document
 * inbox upload route.
 *
 * Task #146 closed the same hole on the avatar route, but the
 * `/api/documents` multer handler still trusted `file.mimetype` and
 * fed the bytes straight into AI extraction + persistent storage. A
 * renamed text file with a forged `image/png` Content-Type is the
 * minimum repro: it sails through `mimetype.startsWith("image/")` and
 * would otherwise land as an "ingested invoice" row, complete with a
 * stored copy on disk and a vision-model call burning credits.
 *
 * What this spec pins in place:
 *
 *  1. POST /api/documents with a forged text-as-PNG body returns 400
 *     with the shared "Only image uploads…" message.
 *  2. The same upload does NOT create a document row (i.e. the gate
 *     trips before `storage.createDocument`, before `saveDocumentFile`
 *     touches disk, and before `extractDocument` calls OpenAI).
 *  3. POST with a forged JPEG covers the second branch of the
 *     magic-bytes check (different signature, same expectation).
 *  4. POST with a non-image MIME (text/plain, no spoofing) is still
 *     rejected by the multer fileFilter — the original gate must keep
 *     working, so we know the magic-bytes check is a defence-in-depth
 *     layer and not the only thing standing between a renamed shell
 *     script and the bucket.
 *
 * The spec drives everything over HTTP using the same cookie-jar
 * bootstrap pattern as `ai-audit-attribution.spec.ts` so it doesn't
 * depend on a Playwright storage state from any other suite.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "Sup3rS3cret!42";

class CookieJar {
  private store = new Map<string, string>();
  ingest(setCookieHeaders: string[]) {
    for (const h of setCookieHeaders) {
      const [pair] = h.split(";");
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.store.set(name.trim(), rest.join("=").trim());
    }
  }
  asHeader(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

interface Session {
  jar: CookieJar;
  email: string;
  companyId: number;
  headers: Record<string, string>;
}

interface ApiResponse {
  status: number;
  body: unknown;
  text: string;
}

type HeadersWithGetSetCookie = Headers & { getSetCookie: () => string[] };

async function callJson(
  method: string,
  path: string,
  jar: CookieJar,
  init?: { body?: unknown; headers?: Record<string, string> },
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-proto": "https",
    cookie: jar.asHeader(),
    ...(init?.headers ?? {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const setCookie = (res.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
  if (setCookie.length) jar.ingest(setCookie);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body, text };
}

/**
 * Build a multipart/form-data body with a single `file` part. We assemble
 * the body by hand instead of pulling in `form-data` so the spec stays a
 * single-file probe and so we can control every byte that lands in the
 * upload buffer (which is exactly what the magic-bytes check inspects).
 */
function multipartBody(opts: {
  filename: string;
  contentType: string;
  bytes: Buffer;
}): { body: Buffer; contentType: string } {
  const boundary = `----magic-bytes-${Math.random().toString(36).slice(2, 10)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${opts.filename}"\r\n` +
      `Content-Type: ${opts.contentType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, opts.bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function uploadDocument(
  session: Session,
  opts: { filename: string; contentType: string; bytes: Buffer },
): Promise<ApiResponse> {
  const { body, contentType } = multipartBody(opts);
  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-forwarded-proto": "https",
      cookie: session.jar.asHeader(),
      ...session.headers,
    },
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body: parsed, text };
}

async function bootstrapUser(): Promise<Session> {
  const jar = new CookieJar();
  const email = `doc-magic-${RUN_TAG}@example.test`;
  // Spoof a unique forwarded IP so the express signup rate limiter
  // (keyed by client IP) doesn't throttle re-runs of this spec.
  const forwardedFor = `10.${(Date.now() >> 16) & 0xff}.${
    (Date.now() >> 8) & 0xff
  }.${Math.floor(Math.random() * 200) + 1}`;
  const ipHeader = { "x-forwarded-for": forwardedFor };

  const signup = await callJson("POST", "/api/auth/signup", jar, {
    body: {
      email,
      password: PASSWORD,
      firstName: "Magic",
      lastName: "Bytes",
      preferredLocale: "en",
    },
    headers: ipHeader,
  });
  expect(signup.status, `signup: ${signup.text}`).toBe(201);

  const company = await callJson("POST", "/api/companies", jar, {
    body: {
      name: `Doc Magic ${RUN_TAG}`,
      functionalCurrency: "USD",
      currencySymbol: "$",
      isDefault: false,
      isActive: true,
    },
  });
  expect(company.status, `create company: ${company.text}`).toBe(201);
  const companyId = (company.body as { id: number }).id;

  return { jar, email, companyId, headers: { "x-company-id": String(companyId) } };
}

async function countDocsForCompany(companyId: number): Promise<number> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL must be set for this test.");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const res = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM documents WHERE company_id = $1`,
      [companyId],
    );
    return Number(res.rows[0]?.count ?? "0");
  } finally {
    await client.end();
  }
}

test.describe("POST /api/documents magic-bytes gate @api", () => {
  test("rejects forged image uploads before extraction or storage", async () => {
    const session = await bootstrapUser();

    // Sanity: brand-new workspace has no document rows.
    expect(await countDocsForCompany(session.companyId)).toBe(0);

    // ── 1. Forged PNG: shell-script bytes with image/png MIME ────────────
    const forgedPng = await uploadDocument(session, {
      filename: "totally-an-invoice.png",
      contentType: "image/png",
      bytes: Buffer.from("#!/bin/sh\necho not really a png\n", "utf8"),
    });
    expect(forgedPng.status, forgedPng.text).toBe(400);
    expect((forgedPng.body as { message?: string }).message).toMatch(
      /image uploads/i,
    );

    // ── 2. Forged JPEG: plain text with image/jpeg MIME ──────────────────
    const forgedJpeg = await uploadDocument(session, {
      filename: "receipt.jpg",
      contentType: "image/jpeg",
      bytes: Buffer.from("not a jpeg, just plain text", "utf8"),
    });
    expect(forgedJpeg.status, forgedJpeg.text).toBe(400);
    expect((forgedJpeg.body as { message?: string }).message).toMatch(
      /image uploads/i,
    );

    // ── 3. Old gate still works: non-image MIME hits the multer filter ──
    const txt = await uploadDocument(session, {
      filename: "note.txt",
      contentType: "text/plain",
      bytes: Buffer.from("hello world", "utf8"),
    });
    expect(txt.status, txt.text).toBe(400);
    expect((txt.body as { message?: string }).message).toMatch(/image uploads/i);

    // ── 4. None of the above created a document row. The whole point of
    //      this gate is to trip BEFORE storage / extraction — if any row
    //      survived we'd be paying for a vision-model call on garbage and
    //      keeping a renamed shell script around as an "ingested invoice".
    expect(await countDocsForCompany(session.companyId)).toBe(0);
  });
});
