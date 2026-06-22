/**
 * Email connector via Resend API.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   RESEND_API_KEY  — Resend API key (re_*)
 *   EMAIL_FROM      — verified sender address (e.g., board@yourorg.com)
 */

export type EmailSendResult = { id: string; delivered: boolean };

export async function emailSend(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  unsubscribeUrl?: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY env var is not set");

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM env var is not set");

  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.text ? { text: opts.text } : {}),
    ...(Object.keys(headers).length ? { headers } : {})
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || data.error) {
    throw new Error(`Resend API error: ${data.error?.message ?? res.statusText}`);
  }
  return { id: data.id ?? "", delivered: true };
}
