import { z } from "zod";
import type { SendEmailInput, SendEmailResult } from "./infrai_email";

export const signupRequestSchema = z.object({
  email: z.string().email(),
  contact_name: z.string().trim().min(1).max(100),
  matter: z.object({
    matter_id: z.string().trim().min(1).max(64),
    client_name: z.string().trim().min(1).max(120),
    intake_summary: z.string().trim().min(1).max(2000)
  }),
  signed_document: z.object({
    title: z.string().trim().min(1).max(160),
    delivered_at: z.string().datetime()
  }),
  follow_up: z.object({
    deadline: z.string().date(),
    note: z.string().trim().min(1).max(500)
  })
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;

type EmailSender = {
  send(payload: SendEmailInput, idempotencyKey: string): Promise<SendEmailResult>;
};

export type PendingVerification = {
  status: "pending_email_verification";
  matter_id: string;
  message_id: string;
  follow_up_deadline: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

export async function beginLegalSignup(
  input: SignupRequest,
  verificationBaseUrl: string,
  sender: EmailSender
): Promise<PendingVerification> {
  const token = Buffer.from(`${input.matter.matter_id}:${input.email}`).toString("base64url");
  const verificationUrl = new URL("/verify-email", verificationBaseUrl);
  verificationUrl.searchParams.set("token", token);

  const result = await sender.send(
    {
      to: input.email,
      subject: `Verify email for matter ${input.matter.matter_id}`,
      html: `<p>Hello ${escapeHtml(input.contact_name)},</p><p>Verify your email to continue matter ${escapeHtml(input.matter.matter_id)}.</p><p><a href="${verificationUrl.toString()}">Verify email</a></p>`
    },
    `matter-verification:${input.matter.matter_id}:${input.email}`
  );

  return {
    status: "pending_email_verification",
    matter_id: input.matter.matter_id,
    message_id: result.message_id,
    follow_up_deadline: input.follow_up.deadline
  };
}
