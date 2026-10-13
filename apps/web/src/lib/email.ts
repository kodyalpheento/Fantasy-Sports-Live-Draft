import 'server-only';

interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Sends through Resend when RESEND_API_KEY is set; otherwise prints the email (local development). */
export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`\n[email] To: ${email.to}\n[email] Subject: ${email.subject}\n${email.text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'Live Draft <no-reply@example.com>', to: [email.to], subject: email.subject, text: email.text, html: email.html }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text()}`);
}

function layout(title: string, body: string, cta: { label: string; url: string }) {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#0b1020;color:#e5e7eb;padding:32px">
<div style="max-width:520px;margin:auto;background:#121a2f;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.5">${body}</p>
<p><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#10b981;color:#04120c;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>
<p style="font-size:12px;color:#94a3b8">If the button does not work, paste this link into your browser:<br>${escapeHtml(cta.url)}</p>
</div></body></html>`;
}

export function inviteEmail(to: string, leagueName: string, inviter: string, url: string): Email {
  const subject = `${inviter} invited you to ${leagueName}`;
  return {
    to,
    subject,
    text: `${inviter} invited you to join the fantasy league "${leagueName}" on Live Draft.\n\nAccept the invite: ${url}\n\nSign in with this email address. Two-factor authentication is required.`,
    html: layout(subject, `${escapeHtml(inviter)} invited you to join <b>${escapeHtml(leagueName)}</b> on Live Draft. Sign in with this email address — two-factor authentication is required.`, { label: 'Accept invite', url }),
  };
}

export function passwordResetEmail(to: string, url: string): Email {
  return {
    to,
    subject: 'Reset your Live Draft password',
    text: `Someone asked to reset the password for this account. If it was you, open this link within 1 hour:\n${url}\n\nIf not, you can ignore this email.`,
    html: layout('Reset your password', 'Someone asked to reset the password for this account. If it was you, use the button below within 1 hour. If not, you can ignore this email.', { label: 'Reset password', url }),
  };
}
