import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * Regression net for task #196 — the magic-bytes gate on the document
 * inbox upload route — and task #248, which widened that gate to
 * accept PDFs (the format most vendor invoices actually arrive in).
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
 *  4. POST with a non-image, non-PDF MIME (text/plain, no spoofing)
 *     is still rejected by the multer fileFilter, and the user-facing
 *     error message names PDF alongside the four image formats — so a
 *     user who tries to upload a `.txt` knows what they SHOULD upload.
 *  5. POST with a forged `application/pdf` Content-Type wrapping
 *     non-PDF bytes is rejected by the magic-bytes check too — the
 *     PDF branch added in task #248 still trusts the bytes, not the
 *     caller.
 *  6. A real PDF (one with a `%PDF-` header) gets PAST the magic-bytes
 *     gate and creates a document row. We don't assert on the AI
 *     extraction outcome (that depends on a real OpenAI call which
 *     may succeed or surface a non-200-from-OpenAI error and mark the
 *     row as `error`), only that the upload was no longer rejected at
 *     the format gate.
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

/**
 * Smallest possible byte sequence that satisfies the magic-bytes PDF
 * sniff (`%PDF-`). This is NOT a valid PDF — the OpenAI extraction call
 * downstream is expected to return an error and mark the row as
 * `status: "error"`. We assert only on the gate, not on extraction.
 */
const PDF_HEADER_STUB = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");

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

    // ── 3. Old gate still works: non-image, non-PDF MIME hits the multer
    //      filter, and the user-facing message names PDF too — task #248
    //      widened the gate, so the error has to widen with it.
    const txt = await uploadDocument(session, {
      filename: "note.txt",
      contentType: "text/plain",
      bytes: Buffer.from("hello world", "utf8"),
    });
    expect(txt.status, txt.text).toBe(400);
    expect((txt.body as { message?: string }).message).toMatch(/image uploads/i);
    expect((txt.body as { message?: string }).message).toMatch(/pdf/i);

    // ── 4. Forged PDF: plain text with application/pdf MIME ──────────────
    //      The PDF branch added in #248 must still trust the bytes — a
    //      renamed text file with the right Content-Type would otherwise
    //      land on disk and burn a vision-model call.
    const forgedPdf = await uploadDocument(session, {
      filename: "vendor-invoice.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("not really a pdf\n", "utf8"),
    });
    expect(forgedPdf.status, forgedPdf.text).toBe(400);
    expect((forgedPdf.body as { message?: string }).message).toMatch(/pdf/i);

    // ── 5. None of the above created a document row. The whole point of
    //      this gate is to trip BEFORE storage / extraction — if any row
    //      survived we'd be paying for a vision-model call on garbage and
    //      keeping a renamed shell script around as an "ingested invoice".
    expect(await countDocsForCompany(session.companyId)).toBe(0);
  });

  test("accepts a real PDF past the magic-bytes gate", async () => {
    const session = await bootstrapUser();
    expect(await countDocsForCompany(session.companyId)).toBe(0);

    // A buffer whose first five bytes are `%PDF-` should sail past the
    // format gate that used to be image-only. We don't care whether the
    // downstream OpenAI call succeeds — it almost certainly won't on a
    // 14-byte stub — only that the row was created (i.e. the gate let
    // it through and `storage.createDocument` ran). The route returns
    // 201 with `status: "ready"` on success or `status: "error"` on
    // extractor failure; both are acceptable here.
    const realish = await uploadDocument(session, {
      filename: "vendor-invoice.pdf",
      contentType: "application/pdf",
      bytes: PDF_HEADER_STUB,
    });
    expect(realish.status, realish.text).toBe(201);
    const created = realish.body as { id: number; mimeType: string; status: string };
    expect(created.id).toBeGreaterThan(0);
    expect(created.mimeType).toBe("application/pdf");
    expect(["ready", "extracting", "error"]).toContain(created.status);
    expect(await countDocsForCompany(session.companyId)).toBe(1);
  });
});
