const secret = process.env.MAGIC_LINK_SECRET ?? "";

if (!secret) {
  throw new Error(
    "MAGIC_LINK_SECRET is required. Generate one with: openssl rand -hex 32",
  );
}

const ttlRaw = parseInt(process.env.MAGIC_LINK_TTL_MINUTES ?? "{token_ttl_minutes}", 10);

export const MAGIC_LINK_CONFIG = {
  secret,
  ttlMs: (Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 15) * 60 * 1000,
  fromAddress: process.env.MAGIC_LINK_FROM ?? "{from_address}",
  appUrl: (process.env.APP_URL ?? "{app_url}").replace(/\/$/, ""),
  transport: (process.env.MAGIC_LINK_TRANSPORT ?? "{email_transport}") as "resend" | "nodemailer",
} as const;
