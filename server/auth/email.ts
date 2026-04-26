/**
 * Transactional email transport. Uses the Resend HTTP API when
 * `RESEND_API_KEY` is configured. Falls back to a no-op (returning
 * `false`) so that callers can decide how to behave (e.g. log a dev
 * link, surface a soft failure) when the provider is not wired up.
 *
 * No SDK dependency: uses `fetch` directly to keep `package.json`
 * unchanged and avoid pinning a client version.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string };

export type EmailLocale = "ar" | "en";

const DEFAULT_FROM = "Tahasab <onboarding@resend.dev>";

function getFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Test-only in-memory stub for the email transport.
 *
 * Lets the delivery-alert dedupe + retry e2e spec drive `sendEmail` to a
 * deterministic per-address outcome (success or `send_failed`) without
 * standing up a real Resend account or talking to the network. The state
 * is mutated through a NODE_ENV-gated route (`POST /api/dev/email-stub`)
 * so a Playwright test running in a separate process can install / clear
 * it between cases.
 *
 * When non-null, *every* `sendEmail` call short-circuits — the real
 * provider is never invoked. Cleared by passing `null` (or an explicit
 * `{ failAddresses: [], successOnly: true }` no-op). Production builds
 * should never reach the route that sets this; the stub state is also
 * ignored implicitly because production callers never POST the route.
 */
type EmailTestStub = {
  failAddresses: Set<string>;
};
let emailTestStub: EmailTestStub | null = null;

export function setEmailTestStub(
  opts: { failAddresses: string[] } | null,
): void {
  if (opts === null) {
    emailTestStub = null;
    return;
  }
  emailTestStub = {
    failAddresses: new Set(
      opts.failAddresses.map((e) => e.trim().toLowerCase()),
    ),
  };
}

export function getEmailTestStub(): EmailTestStub | null {
  return emailTestStub;
}

/** Coerce any string into a supported locale, defaulting to Arabic. */
export function normalizeLocale(value: unknown): EmailLocale {
  return value === "en" ? "en" : "ar";
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // Test stub short-circuit: when installed, every send is resolved against
  // an in-memory map so the delivery-alert dedupe + retry e2e spec can drive
  // per-address success / failure deterministically without a real provider.
  // Only the route that sets the stub is NODE_ENV-gated; production never
  // installs it, so this branch is inert there.
  const stub = emailTestStub;
  if (stub) {
    const addr = input.to.trim().toLowerCase();
    if (stub.failAddresses.has(addr)) {
      return { ok: false, reason: "send_failed", error: "stub_failed" };
    }
    return { ok: true, id: `stub-${addr}` };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFrom(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend API error ${res.status}: ${body}`);
      return { ok: false, reason: "send_failed", error: `${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id ?? null };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: "send_failed", error: (err as Error).message };
  }
}

// ---------- branded templates ----------

const BRAND = "Tahasab";
const BRAND_COLOR = "#0f766e"; // teal-700

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Append (or replace) a `lang` query parameter on a link so a recipient
 * can switch languages by following the toggle link in the email body.
 */
function withLangParam(link: string, locale: EmailLocale): string {
  try {
    const u = new URL(link);
    u.searchParams.set("lang", locale);
    return u.toString();
  } catch {
    const sep = link.includes("?") ? "&" : "?";
    return `${link}${sep}lang=${locale}`;
  }
}

type LayoutArgs = {
  locale: EmailLocale;
  previewText: string;
  bodyHtml: string;
  footerText: string;
  footerNote: string;
};

function layout(args: LayoutArgs): string {
  const dir = args.locale === "ar" ? "rtl" : "ltr";
  const lang = args.locale;
  const align = args.locale === "ar" ? "right" : "left";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(BRAND)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;" dir="${dir}">
    <span style="display:none!important;opacity:0;visibility:hidden;height:0;width:0;overflow:hidden;">${escapeHtml(args.previewText)}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">
            <tr>
              <td align="${align}" style="padding:24px 32px;border-bottom:1px solid #e4e4e7;background:${BRAND_COLOR};color:#ffffff;font-size:18px;font-weight:600;">
                ${escapeHtml(BRAND)}
              </td>
            </tr>
            <tr>
              <td align="${align}" style="padding:32px;font-size:15px;line-height:1.6;color:#27272a;">
                ${args.bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="${align}" style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;line-height:1.5;">
                ${escapeHtml(args.footerText)}<br/>
                ${escapeHtml(args.footerNote)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:8px;background:${BRAND_COLOR};">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

// ---------- localized strings ----------
//
// Each template is a pure function from inputs to localized copy. Adding a
// new locale is just a matter of adding another entry to the maps below.

type InviteCopy = {
  subject: string;
  preview: string;
  greeting: string;
  cta: string;
  acceptLabel: string;
  copyHint: string;
  switchLanguage: string;
  footerText: string;
  footerNote: string;
  textBody: string;
};

function inviteCopy(args: {
  locale: EmailLocale;
  link: string;
  altLink: string;
  role: string;
  company: string;
  inviter?: string;
  altLanguageLabel: string;
}): InviteCopy {
  const { locale, role, company, inviter, link, altLink, altLanguageLabel } = args;
  if (locale === "ar") {
    return {
      subject: `${inviter ? `${inviter} دعاك` : "تمت دعوتك"} للانضمام إلى ${company} على ${BRAND}`,
      preview: `انضم إلى ${company} على ${BRAND}`,
      greeting: inviter
        ? `<strong>${escapeHtml(inviter)}</strong> دعاك للانضمام إلى <strong>${escapeHtml(company)}</strong> على ${BRAND} بصلاحية <strong>${escapeHtml(role)}</strong>.`
        : `تمت دعوتك للانضمام إلى <strong>${escapeHtml(company)}</strong> على ${BRAND} بصلاحية <strong>${escapeHtml(role)}</strong>.`,
      cta: "اضغط الزر أدناه لقبول الدعوة. تنتهي صلاحية الرابط خلال 7 أيام.",
      acceptLabel: "قبول الدعوة",
      copyHint: "أو انسخ هذا الرابط إلى متصفحك:",
      switchLanguage: `<a href="${escapeHtml(altLink)}" style="color:${BRAND_COLOR};">${escapeHtml(altLanguageLabel)}</a>`,
      footerText: `${BRAND} — محاسبة آمنة للفرق الحديثة.`,
      footerNote: "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.",
      textBody: [
        `${inviter ? `${inviter} دعاك` : "تمت دعوتك"} للانضمام إلى ${company} على ${BRAND} بصلاحية ${role}.`,
        "",
        "لقبول الدعوة:",
        link,
        "",
        "تنتهي صلاحية هذا الرابط خلال 7 أيام.",
        "",
        `${altLanguageLabel}: ${altLink}`,
      ].join("\n"),
    };
  }
  return {
    subject: `${inviter ? `${inviter} invited you` : "You're invited"} to join ${company} on ${BRAND}`,
    preview: `Join ${company} on ${BRAND}`,
    greeting: inviter
      ? `<strong>${escapeHtml(inviter)}</strong> has invited you to join <strong>${escapeHtml(company)}</strong> on ${BRAND} as <strong>${escapeHtml(role)}</strong>.`
      : `You've been invited to join <strong>${escapeHtml(company)}</strong> on ${BRAND} as <strong>${escapeHtml(role)}</strong>.`,
    cta: "Click the button below to accept the invitation. The link will expire in 7 days.",
    acceptLabel: "Accept invitation",
    copyHint: "Or copy this link into your browser:",
    switchLanguage: `<a href="${escapeHtml(altLink)}" style="color:${BRAND_COLOR};">${escapeHtml(altLanguageLabel)}</a>`,
    footerText: `${BRAND} — secure accounting for modern teams.`,
    footerNote: "If you didn't expect this email you can safely ignore it.",
    textBody: [
      `${inviter ? `${inviter} invited you` : "You're invited"} to join ${company} on ${BRAND} as ${role}.`,
      "",
      "Accept the invitation:",
      link,
      "",
      "This link expires in 7 days.",
      "",
      `${altLanguageLabel}: ${altLink}`,
    ].join("\n"),
  };
}

type ResetCopy = {
  subject: string;
  preview: string;
  greeting: string;
  body: string;
  acceptLabel: string;
  copyHint: string;
  ignoreNote: string;
  footerText: string;
  footerNote: string;
  textBody: string;
};

function resetCopy(args: {
  locale: EmailLocale;
  link: string;
  name?: string;
}): ResetCopy {
  const { locale, link, name } = args;
  if (locale === "ar") {
    return {
      subject: `إعادة تعيين كلمة المرور — ${BRAND}`,
      preview: `إعادة تعيين كلمة المرور الخاصة بك في ${BRAND}`,
      greeting: name ? `مرحباً ${escapeHtml(name)}،` : "مرحباً،",
      body: `تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك في ${BRAND}. اضغط الزر أدناه لاختيار كلمة مرور جديدة. تنتهي صلاحية الرابط خلال ساعة واحدة.`,
      acceptLabel: "إعادة تعيين كلمة المرور",
      copyHint: "أو انسخ هذا الرابط إلى متصفحك:",
      ignoreNote: "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان — لن تتغير كلمة المرور.",
      footerText: `${BRAND} — محاسبة آمنة للفرق الحديثة.`,
      footerNote: "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.",
      textBody: [
        `${name ? `مرحباً ${name}،` : "مرحباً،"}`,
        "",
        `أعد تعيين كلمة المرور الخاصة بك في ${BRAND} عبر هذا الرابط (تنتهي خلال ساعة):`,
        link,
        "",
        "إذا لم تطلب ذلك، تجاهل هذه الرسالة.",
      ].join("\n"),
    };
  }
  return {
    subject: `Reset your ${BRAND} password`,
    preview: `Reset your ${BRAND} password`,
    greeting: name ? `Hi ${escapeHtml(name)},` : "Hi,",
    body: `We received a request to reset your ${BRAND} password. Click the button below to choose a new one. This link will expire in 1 hour.`,
    acceptLabel: "Reset password",
    copyHint: "Or copy this link into your browser:",
    ignoreNote: "If you didn't request this, you can safely ignore this email — your password won't change.",
    footerText: `${BRAND} — secure accounting for modern teams.`,
    footerNote: "If you didn't expect this email you can safely ignore it.",
    textBody: [
      `${name ? `Hi ${name},` : "Hi,"}`,
      "",
      `Reset your ${BRAND} password using this link (expires in 1 hour):`,
      link,
      "",
      "If you didn't request this, ignore this email.",
    ].join("\n"),
  };
}

export async function sendInvitationEmail(args: {
  to: string;
  link: string;
  role: string;
  companyName?: string | null;
  inviterName?: string | null;
  /** Locale of the inviter (or system default). The invitee may not exist yet. */
  locale?: EmailLocale;
}): Promise<SendEmailResult> {
  const { to, link, role } = args;
  const locale = normalizeLocale(args.locale);
  const altLocale: EmailLocale = locale === "ar" ? "en" : "ar";
  const company = args.companyName?.trim() || BRAND;
  const inviter = args.inviterName?.trim() || undefined;

  // The accept link encodes the language preference so the landing page
  // can render in the same language as the email and so the toggle below
  // simply re-opens the same link in the other language.
  const localizedLink = withLangParam(link, locale);
  const altLink = withLangParam(link, altLocale);
  const altLanguageLabel = altLocale === "ar" ? "اقرأ بالعربية" : "Read in English";

  const copy = inviteCopy({
    locale,
    link: localizedLink,
    altLink,
    role,
    company,
    inviter,
    altLanguageLabel,
  });

  // Bilingual subject line so the invitee — who may not yet have a locale
  // preference recorded — can recognize the email regardless of language.
  const altCopy = inviteCopy({
    locale: altLocale,
    link: altLink,
    altLink: localizedLink,
    role,
    company,
    inviter,
    altLanguageLabel: "",
  });
  const subject = `${copy.subject} · ${altCopy.subject}`;

  const html = layout({
    locale,
    previewText: copy.preview,
    footerText: copy.footerText,
    footerNote: copy.footerNote,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">${copy.greeting}</p>
      <p style="margin:0 0 16px 0;">${escapeHtml(copy.cta)}</p>
      ${button(localizedLink, copy.acceptLabel)}
      <p style="margin:0 0 16px 0;color:#52525b;font-size:13px;">${escapeHtml(copy.copyHint)}<br/><a href="${escapeHtml(localizedLink)}" style="color:${BRAND_COLOR};word-break:break-all;">${escapeHtml(localizedLink)}</a></p>
      <p style="margin:24px 0 0 0;color:#71717a;font-size:12px;">${copy.switchLanguage}</p>
    `,
  });

  return sendEmail({ to, subject, html, text: copy.textBody });
}

// ---------- delivery-health alert ----------

type AlertCopy = {
  subject: string;
  preview: string;
  intro: string;
  reasonLabel: string;
  ctaLabel: string;
  noteLabel: string;
  footerText: string;
  footerNote: string;
  textBody: string;
};

function alertCopy(args: {
  locale: EmailLocale;
  workspace: string;
  reason: "absolute" | "ratio";
  failures: number;
  sends: number;
  windowHours: number;
  bounced: number;
  complained: number;
  sendFailed: number;
  link: string;
}): AlertCopy {
  const {
    locale,
    workspace,
    reason,
    failures,
    sends,
    windowHours,
    bounced,
    complained,
    sendFailed,
    link,
  } = args;
  const ratioPct =
    sends > 0 ? `${((failures / sends) * 100).toFixed(1)}%` : "—";

  if (locale === "ar") {
    const reasonAr =
      reason === "absolute"
        ? `تجاوزت الإخفاقات (${failures}) العتبة المُعرّفة خلال آخر ${windowHours} ساعة.`
        : `بلغت نسبة الإخفاقات ${ratioPct} (${failures} من ${sends}) خلال آخر ${windowHours} ساعة.`;
    return {
      subject: `تنبيه صحة البريد — ${workspace}`,
      preview: `${failures} رسالة فشلت خلال ${windowHours} ساعة في ${workspace}`,
      intro: `لاحظنا ارتفاعاً في إخفاقات البريد التحويلي على مساحة عمل <strong>${escapeHtml(
        workspace,
      )}</strong>.`,
      reasonLabel: reasonAr,
      ctaLabel: "افتح صحة البريد",
      noteLabel:
        "تابع التفاصيل واتخذ إجراء (تحديث القائمة، تنبيه المزود، أو تحديث العتبات) من صفحة صحة بريد المعاملات.",
      footerText: `${BRAND} — محاسبة آمنة للفرق الحديثة.`,
      footerNote:
        "تتلقى هذه الرسالة لأنك مالك المساحة. يمكنك إيقاف التنبيه من إعدادات صحة البريد.",
      textBody: [
        `تنبيه صحة البريد — ${workspace}`,
        "",
        reasonAr,
        `الارتدادات: ${bounced} · بلاغات السبام: ${complained} · فشل الإرسال: ${sendFailed}`,
        "",
        `افتح: ${link}`,
      ].join("\n"),
    };
  }
  const reasonEn =
    reason === "absolute"
      ? `Failures (${failures}) crossed your configured threshold over the last ${windowHours}h.`
      : `Failure ratio hit ${ratioPct} (${failures} of ${sends}) over the last ${windowHours}h.`;
  return {
    subject: `Email delivery alert — ${workspace}`,
    preview: `${failures} failures in the last ${windowHours}h on ${workspace}`,
    intro: `We've noticed a spike in transactional email failures on the <strong>${escapeHtml(
      workspace,
    )}</strong> workspace.`,
    reasonLabel: reasonEn,
    ctaLabel: "Open delivery health",
    noteLabel:
      "Investigate the affected sends and take action (clean the list, contact your provider, adjust the thresholds) from the email delivery page.",
    footerText: `${BRAND} — secure accounting for modern teams.`,
    footerNote:
      "You're receiving this because you own this workspace. You can mute the alert in the email delivery settings.",
    textBody: [
      `Email delivery alert — ${workspace}`,
      "",
      reasonEn,
      `Bounced: ${bounced} · Spam reports: ${complained} · Send failures: ${sendFailed}`,
      "",
      `Open: ${link}`,
    ].join("\n"),
  };
}

export async function sendEmailDeliveryAlertEmail(args: {
  to: string[];
  workspace: string;
  reason: "absolute" | "ratio";
  failures: number;
  sends: number;
  windowHours: number;
  bounced: number;
  complained: number;
  sendFailed: number;
  link: string;
  locale?: EmailLocale;
}): Promise<SendEmailResult[]> {
  if (args.to.length === 0) return [];
  const locale = normalizeLocale(args.locale);
  const copy = alertCopy({
    locale,
    workspace: args.workspace,
    reason: args.reason,
    failures: args.failures,
    sends: args.sends,
    windowHours: args.windowHours,
    bounced: args.bounced,
    complained: args.complained,
    sendFailed: args.sendFailed,
    link: args.link,
  });

  const html = layout({
    locale,
    previewText: copy.preview,
    footerText: copy.footerText,
    footerNote: copy.footerNote,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">${copy.intro}</p>
      <p style="margin:0 0 16px 0;">${escapeHtml(copy.reasonLabel)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;border-collapse:collapse;font-size:13px;color:#27272a;">
        <tr>
          <td style="padding:6px 12px 6px 0;color:#71717a;">${
            locale === "ar" ? "الارتدادات" : "Bounced"
          }</td>
          <td style="padding:6px 0;font-weight:600;">${args.bounced}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:#71717a;">${
            locale === "ar" ? "بلاغات السبام" : "Spam reports"
          }</td>
          <td style="padding:6px 0;font-weight:600;">${args.complained}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:#71717a;">${
            locale === "ar" ? "فشل الإرسال" : "Send failures"
          }</td>
          <td style="padding:6px 0;font-weight:600;">${args.sendFailed}</td>
        </tr>
      </table>
      ${button(args.link, copy.ctaLabel)}
      <p style="margin:0 0 0 0;color:#52525b;font-size:13px;">${escapeHtml(copy.noteLabel)}</p>
    `,
  });

  // Send one message per recipient so a bad address can't block the rest.
  const results = await Promise.all(
    args.to.map((to) =>
      sendEmail({ to, subject: copy.subject, html, text: copy.textBody }),
    ),
  );
  return results;
}

/**
 * Operator-facing alert: a `workspace_isolation` policy in the
 * production database has drifted from the canonical expression
 * installed by `migrations/0008_workspace_rls.sql`. Sent once per
 * offending table (so a drift across N tables produces N emails) by
 * the runtime sweep in `server/auth/rls-policy-drift-alerts.ts`.
 *
 * This is a system-level alert — it has no per-workspace context, so
 * no locale / RTL templating: every recipient is an owner of *some*
 * workspace and the body is a short English operator message that
 * names the offending table and the offending clause text.
 *
 * Returns one `SendEmailResult` per recipient address.
 */
export async function sendRlsPolicyDriftAlertEmail(args: {
  to: string[];
  table: string;
  problems: string[];
  qual: string | null;
  withCheck: string | null;
  canonicalExpression: string;
  link?: string;
}): Promise<SendEmailResult[]> {
  if (args.to.length === 0) return [];
  const subject = `RLS policy drift on "${args.table}" — workspace isolation may be broken`;
  const problemsList = args.problems
    .map((p) => `      <li style="margin:0 0 6px 0;">${escapeHtml(p)}</li>`)
    .join("\n");
  const linkBlock = args.link
    ? `<p style="margin:16px 0 0 0;">${button(args.link, "Open production policy audit")}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;color:#18181b;font-family:Inter,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:24px;text-align:left;">
          <tr><td>
            <p style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:${BRAND_COLOR};">⚠ Production RLS policy drift</p>
            <p style="margin:0 0 12px 0;">The <code>workspace_isolation</code> policy on <strong>${escapeHtml(args.table)}</strong> in the production database does not match the canonical expression installed by <code>migrations/0008_workspace_rls.sql</code>.</p>
            <p style="margin:0 0 6px 0;font-weight:600;">Drift</p>
            <ul style="margin:0 0 12px 16px;padding:0;font-size:13px;color:#27272a;">
${problemsList}
            </ul>
            <p style="margin:0 0 6px 0;font-weight:600;">Expected (both clauses)</p>
            <pre style="margin:0 0 12px 0;padding:8px 12px;background:#f4f4f5;border-radius:6px;font-size:12px;white-space:pre-wrap;">${escapeHtml(args.canonicalExpression)}</pre>
            <p style="margin:0 0 6px 0;font-weight:600;">Live USING</p>
            <pre style="margin:0 0 12px 0;padding:8px 12px;background:#f4f4f5;border-radius:6px;font-size:12px;white-space:pre-wrap;">${escapeHtml(args.qual ?? "(null)")}</pre>
            <p style="margin:0 0 6px 0;font-weight:600;">Live WITH CHECK</p>
            <pre style="margin:0 0 12px 0;padding:8px 12px;background:#f4f4f5;border-radius:6px;font-size:12px;white-space:pre-wrap;">${escapeHtml(args.withCheck ?? "(null)")}</pre>
            <p style="margin:0 0 0 0;color:#52525b;font-size:13px;">Re-apply the canonical policy by re-running the DO-block in <code>migrations/0008_workspace_rls.sql</code> (or, for <code>audit_log</code>, <code>migrations/0016_audit_log_company_id.sql</code>).</p>
            ${linkBlock}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Production RLS policy drift on "${args.table}".`,
    "",
    "The workspace_isolation policy does not match the canonical expression",
    "installed by migrations/0008_workspace_rls.sql.",
    "",
    "Drift:",
    ...args.problems.map((p) => `  - ${p}`),
    "",
    `Expected (both clauses): ${args.canonicalExpression}`,
    `Live USING:              ${args.qual ?? "(null)"}`,
    `Live WITH CHECK:         ${args.withCheck ?? "(null)"}`,
    "",
    "Re-apply the canonical policy by re-running the DO-block in",
    "migrations/0008_workspace_rls.sql (or migrations/0016_audit_log_company_id.sql",
    "for audit_log).",
    ...(args.link ? ["", `Open: ${args.link}`] : []),
  ].join("\n");

  // One message per recipient so a bad address can't block the rest
  // (mirrors `sendEmailDeliveryAlertEmail`).
  const results = await Promise.all(
    args.to.map((to) => sendEmail({ to, subject, html, text })),
  );
  return results;
}

export async function sendPasswordResetEmail(args: {
  to: string;
  link: string;
  firstName?: string | null;
  /** Recipient's preferred locale. Defaults to Arabic. */
  locale?: EmailLocale;
}): Promise<SendEmailResult> {
  const { to, link } = args;
  const locale = normalizeLocale(args.locale);
  const name = args.firstName?.trim() || undefined;

  const copy = resetCopy({ locale, link, name });

  const html = layout({
    locale,
    previewText: copy.preview,
    footerText: copy.footerText,
    footerNote: copy.footerNote,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">${copy.greeting}</p>
      <p style="margin:0 0 16px 0;">${escapeHtml(copy.body)}</p>
      ${button(link, copy.acceptLabel)}
      <p style="margin:0 0 24px 0;color:#52525b;font-size:13px;">${escapeHtml(copy.copyHint)}<br/><a href="${escapeHtml(link)}" style="color:${BRAND_COLOR};word-break:break-all;">${escapeHtml(link)}</a></p>
      <p style="margin:0;color:#52525b;font-size:13px;">${escapeHtml(copy.ignoreNote)}</p>
    `,
  });

  return sendEmail({ to, subject: copy.subject, html, text: copy.textBody });
}
