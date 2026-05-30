import type { Job } from "bullmq";

export interface EmailJobData {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailJobResult {
  messageId: string;
  acceptedAt: number;
}

export const EMAIL_JOB_NAME = "email";

/**
 * Stub handler — replace with your transport (Resend, SES, SendGrid, etc.).
 * Pure so it can be unit-tested without a Redis connection.
 */
export async function processEmailJob(
  job: Job<EmailJobData>,
): Promise<EmailJobResult> {
  await job.log(`sending email to=${job.data.to} subject="${job.data.subject}"`);

  // TODO: replace stub with real transport
  const messageId = `msg-${job.id}`;

  return {
    messageId,
    acceptedAt: Date.now(),
  };
}
