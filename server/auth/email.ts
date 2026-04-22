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

const DEFAULT_FROM = "Tahasab <onboarding@resend.dev>";

function getFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
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

function layout(args: { previewText: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(BRAND)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <span style="display:none!important;opacity:0;visibility:hidden;height:0;width:0;overflow:hidden;">${escapeHtml(args.previewText)}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;background:${BRAND_COLOR};color:#ffffff;font-size:18px;font-weight:600;">
                ${escapeHtml(BRAND)}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:15px;line-height:1.6;color:#27272a;">
                ${args.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;line-height:1.5;">
                ${escapeHtml(BRAND)} — secure accounting for modern teams.<br/>
                If you didn't expect this email you can safely ignore it.
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

export async function sendInvitationEmail(args: {
  to: string;
  link: string;
  role: string;
  companyName?: string | null;
  inviterName?: string | null;
}): Promise<SendEmailResult> {
  const { to, link, role } = args;
  const company = args.companyName?.trim() || BRAND;
  const inviter = args.inviterName?.trim();
  const subjectEn = `${inviter ? `${inviter} invited you` : "You're invited"} to join ${company} on ${BRAND}`;

  const greetingEn = inviter
    ? `<strong>${escapeHtml(inviter)}</strong> has invited you to join <strong>${escapeHtml(company)}</strong> on ${BRAND} as <strong>${escapeHtml(role)}</strong>.`
    : `You've been invited to join <strong>${escapeHtml(company)}</strong> on ${BRAND} as <strong>${escapeHtml(role)}</strong>.`;

  const greetingAr = `تمت دعوتك للانضمام إلى <strong>${escapeHtml(company)}</strong> على ${escapeHtml(BRAND)} بصلاحية <strong>${escapeHtml(role)}</strong>.`;

  const html = layout({
    previewText: `Join ${company} on ${BRAND}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">${greetingEn}</p>
      <p style="margin:0 0 16px 0;">Click the button below to accept the invitation. The link will expire in 7 days.</p>
      ${button(link, "Accept invitation")}
      <p style="margin:0 0 24px 0;color:#52525b;font-size:13px;">Or copy this link into your browser:<br/><a href="${escapeHtml(link)}" style="color:${BRAND_COLOR};word-break:break-all;">${escapeHtml(link)}</a></p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
      <p dir="rtl" lang="ar" style="margin:0 0 12px 0;">${greetingAr}</p>
      <p dir="rtl" lang="ar" style="margin:0 0 16px 0;">انقر على الزر أعلاه لقبول الدعوة. تنتهي صلاحية الرابط خلال 7 أيام.</p>
    `,
  });

  const text = [
    `${inviter ? `${inviter} invited you` : "You're invited"} to join ${company} on ${BRAND} as ${role}.`,
    "",
    "Accept the invitation:",
    link,
    "",
    "This link expires in 7 days.",
  ].join("\n");

  return sendEmail({ to, subject: subjectEn, html, text });
}

export async function sendPasswordResetEmail(args: {
  to: string;
  link: string;
  firstName?: string | null;
}): Promise<SendEmailResult> {
  const { to, link } = args;
  const name = args.firstName?.trim();
  const greetingEn = name ? `Hi ${escapeHtml(name)},` : "Hi,";

  const html = layout({
    previewText: `Reset your ${BRAND} password`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">${greetingEn}</p>
      <p style="margin:0 0 16px 0;">We received a request to reset your ${BRAND} password. Click the button below to choose a new one. This link will expire in 1 hour.</p>
      ${button(link, "Reset password")}
      <p style="margin:0 0 24px 0;color:#52525b;font-size:13px;">Or copy this link into your browser:<br/><a href="${escapeHtml(link)}" style="color:${BRAND_COLOR};word-break:break-all;">${escapeHtml(link)}</a></p>
      <p style="margin:0 0 0 0;color:#52525b;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
      <p dir="rtl" lang="ar" style="margin:0 0 12px 0;">تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك في ${escapeHtml(BRAND)}. اضغط الزر أعلاه لاختيار كلمة مرور جديدة. تنتهي صلاحية الرابط خلال ساعة واحدة.</p>
      <p dir="rtl" lang="ar" style="margin:0;color:#52525b;font-size:13px;">إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان.</p>
    `,
  });

  const text = [
    `${name ? `Hi ${name},` : "Hi,"}`,
    "",
    `Reset your ${BRAND} password using this link (expires in 1 hour):`,
    link,
    "",
    "If you didn't request this, ignore this email.",
  ].join("\n");

  return sendEmail({ to, subject: `Reset your ${BRAND} password`, html, text });
}
