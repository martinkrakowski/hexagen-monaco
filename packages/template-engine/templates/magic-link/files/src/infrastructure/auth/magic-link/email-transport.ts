import { MAGIC_LINK_CONFIG } from "./config";
import type { MagicLinkEmailContent } from "./email-templates";

export interface SendEmailParams {
  to: string;
  content: MagicLinkEmailContent;
}

async function sendViaResend({ to, content }: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is required when MAGIC_LINK_TRANSPORT=resend.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAGIC_LINK_CONFIG.fromAddress,
      to: [to],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}

async function sendViaNodemailer({ to, content }: SendEmailParams): Promise<void> {
  // Nodemailer is an optional npm dependency — install it with: npm install nodemailer
  // Then uncomment the import below and remove the dynamic require.
  //
  // import nodemailer from "nodemailer";
  //
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = await import("nodemailer").catch(() => {
    throw new Error(
      "nodemailer is not installed. Run: npm install nodemailer\n" +
        "Or switch MAGIC_LINK_TRANSPORT=resend for a zero-dependency option.",
    );
  });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: MAGIC_LINK_CONFIG.fromAddress,
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
}

export async function sendMagicLinkEmail(params: SendEmailParams): Promise<void> {
  if (MAGIC_LINK_CONFIG.transport === "nodemailer") {
    return sendViaNodemailer(params);
  }
  return sendViaResend(params);
}
