import assert from "node:assert/strict";
import test from "node:test";
import { beginLegalSignup, signupRequestSchema } from "../src/signup_verification";

test("a valid legal intake stays pending until the email is verified", async () => {
  let sentSubject = "";
  let sentKey = "";
  const input = signupRequestSchema.parse({
    email: "client@example.com",
    contact_name: "Avery & Co",
    matter: {
      matter_id: "MAT-77",
      client_name: "Avery Client",
      intake_summary: "Contract review"
    },
    signed_document: {
      title: "Signed engagement letter",
      delivered_at: "2026-08-14T09:00:00.000Z"
    },
    follow_up: {
      deadline: "2026-08-20",
      note: "Check verification before filing"
    }
  });

  const result = await beginLegalSignup(input, "https://legal.example", {
    async send(payload, idempotencyKey) {
      sentSubject = payload.subject;
      sentKey = idempotencyKey;
      assert.match(payload.html, /Verify email/);
      assert.match(payload.html, /Avery &amp; Co/);
      return { message_id: "msg_123" };
    }
  });

  assert.deepEqual(result, {
    status: "pending_email_verification",
    matter_id: "MAT-77",
    message_id: "msg_123",
    follow_up_deadline: "2026-08-20"
  });
  assert.equal(sentSubject, "Verify email for matter MAT-77");
  assert.equal(sentKey, "matter-verification:MAT-77:client@example.com");
});
