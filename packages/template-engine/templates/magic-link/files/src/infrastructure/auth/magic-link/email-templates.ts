import { MAGIC_LINK_CONFIG } from "./config";

export interface MagicLinkEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildMagicLinkEmail(
  email: string,
  token: string,
): MagicLinkEmailContent {
  const ttlMinutes = Math.round(MAGIC_LINK_CONFIG.ttlMs / 60_000);
  const link = `${MAGIC_LINK_CONFIG.appUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

  return {
    subject: "Your sign-in link",
    html: `
<!DOCTYPE html>
<html>
  <body style="font-family: sans-serif; max-width: 480px; margin: 40px auto; color: #111;">
    <h2 style="margin-bottom: 8px;">Sign in to your account</h2>
    <p style="color: #555;">Click the button below to sign in as <strong>${email}</strong>.</p>
    <a href="${link}" style="
      display: inline-block;
      margin: 16px 0;
      padding: 12px 24px;
      background: #0070f3;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
    ">Sign in</a>
    <p style="color: #999; font-size: 13px;">
      This link expires in ${ttlMinutes} minutes and can only be used once.<br>
      If you didn't request this, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #ccc; font-size: 11px;">
      Or copy this link: <a href="${link}" style="color: #ccc;">${link}</a>
    </p>
  </body>
</html>`.trim(),
    text: `Sign in to your account\n\nClick this link to sign in as ${email}:\n${link}\n\nThis link expires in ${ttlMinutes} minutes and can only be used once.\nIf you didn't request this, you can safely ignore this email.`,
  };
}
