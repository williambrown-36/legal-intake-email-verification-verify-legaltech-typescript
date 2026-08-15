import { defaultEmailSender } from "../src/infrai_email";
import { beginLegalSignup, signupRequestSchema } from "../src/signup_verification";

const email = process.env.DEMO_EMAIL_TO;
if (!email) throw new Error("DEMO_EMAIL_TO is required");

const signup = signupRequestSchema.parse({
  email,
  contact_name: "Jordan Lee",
  matter: {
    matter_id: "MAT-1042",
    client_name: "Jordan Lee",
    intake_summary: "Review a signed commercial lease before the response deadline."
  },
  signed_document: {
    title: "Signed engagement letter",
    delivered_at: "2026-08-14T09:00:00.000Z"
  },
  follow_up: {
    deadline: "2026-08-21",
    note: "Confirm counsel assignment after email verification."
  }
});

const result = await beginLegalSignup(signup, "http://localhost:3000", defaultEmailSender);
console.log(result);
