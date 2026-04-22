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

/** Coerce any string into a supported locale, defaulting to Arabic. */
export function normalizeLocale(value: unknown): EmailLocale {
  return value === "en" ? "en" : "ar";
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
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
