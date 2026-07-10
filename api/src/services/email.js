// Transactional email via SendGrid's v3 Mail Send API. Called directly with
// fetch (Node 18+ global) so we add no dependency — matching how googleAuth.js
// / auth.js already hand-roll their HTTPS calls.
//
// No-op when unconfigured (local dev, CI, tests): if SENDGRID_API_KEY or
// EMAIL_FROM is unset we log and return { skipped: true } instead of sending,
// so nothing goes out and there's no behavior change. Set both in prod.
//
// SETUP: create a SendGrid API key (Mail Send scope), authenticate the sending
// domain (SPF/DKIM), and set SENDGRID_API_KEY + EMAIL_FROM (a from-address on
// the authenticated domain, e.g. "no-reply@renovateconnect.app").

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

function isConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM);
}

// Send one email. Resolves { skipped: true } when unconfigured, { ok: true } on
// a 2xx from SendGrid, and throws on a non-2xx (callers that don't want a send
// failure to break the request — e.g. resend flows — should catch it).
async function sendEmail({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.warn(`[email] not configured — skipping "${subject}" to ${to}`);
    return { skipped: true };
  }
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: process.env.EMAIL_FROM, name: process.env.EMAIL_FROM_NAME || 'RenovateConnect' },
    subject,
    content: [
      { type: 'text/plain', value: text || '' },
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ],
  };
  const res = await fetch(SENDGRID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Don't include the provider response body in the thrown message — it can
    // echo the payload. Log the status for ops; surface a clean error.
    console.error(`[email] SendGrid responded ${res.status} for "${subject}"`);
    throw new Error(`Email send failed (${res.status})`);
  }
  return { ok: true };
}

// --- Specific templates -----------------------------------------------------

const APP_NAME = 'RenovateConnect';

function verificationEmail(code) {
  return {
    subject: `${APP_NAME}: your verification code`,
    text: `Welcome to ${APP_NAME}! Your email verification code is ${code}. `
      + 'It expires in 15 minutes. If you didn’t create an account, you can ignore this email.',
    html: `<p>Welcome to <strong>${APP_NAME}</strong>!</p>`
      + `<p>Your email verification code is:</p>`
      + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
      + `<p>It expires in 15 minutes. If you didn’t create an account, you can ignore this email.</p>`,
  };
}

function passwordResetEmail(code) {
  return {
    subject: `${APP_NAME}: your password reset code`,
    text: `Your ${APP_NAME} password reset code is ${code}. It expires in 15 minutes. `
      + 'If you didn’t request a reset, you can ignore this email — your password is unchanged.',
    html: `<p>Your <strong>${APP_NAME}</strong> password reset code is:</p>`
      + `<p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>`
      + `<p>It expires in 15 minutes. If you didn’t request a reset, you can ignore this email — `
      + 'your password is unchanged.</p>',
  };
}

function sendVerificationCode(to, code) {
  return sendEmail({ to, ...verificationEmail(code) });
}

function sendPasswordResetCode(to, code) {
  return sendEmail({ to, ...passwordResetEmail(code) });
}

module.exports = {
  isConfigured,
  sendEmail,
  sendVerificationCode,
  sendPasswordResetCode,
  verificationEmail,
  passwordResetEmail,
};
