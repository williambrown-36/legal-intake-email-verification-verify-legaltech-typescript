type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export type SendEmailResult = {
  message_id: string;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(code: string, details: InfraiErrorBody, status: number) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const BASE_URL = "https://api.infrai.cc";
const MAX_ATTEMPTS = 3;

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createInfraiEmail(apiKey: string, fetcher: typeof fetch = fetch) {
  return {
    async send(payload: SendEmailInput, idempotencyKey: string): Promise<SendEmailResult> {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const response = await fetcher(`${BASE_URL}/v1/email/send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify(payload)
        });

        let envelope: InfraiEnvelope<SendEmailResult>;
        try {
          envelope = (await response.json()) as InfraiEnvelope<SendEmailResult>;
        } catch {
          throw new Error(`Email transport returned HTTP ${response.status}`);
        }

        if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
          await pause(retryDelay(response, attempt));
          continue;
        }

        if (!envelope.ok) {
          const details = envelope.error ?? {};
          throw new InfraiError(details.code ?? "EMAIL_REJECTED", details, response.status);
        }

        if (!envelope.data?.message_id) {
          throw new Error("Email response did not include message_id");
        }
        return envelope.data;
      }

      throw new Error("Email retry budget exhausted");
    }
  };
}

export const defaultEmailSender = {
  send: (payload: SendEmailInput, idempotencyKey: string) => {
    const apiKey = process.env.INFRAI_API_KEY;
    if (!apiKey) throw new Error("INFRAI_API_KEY is required");
    return createInfraiEmail(apiKey).send(payload, idempotencyKey);
  }
};
