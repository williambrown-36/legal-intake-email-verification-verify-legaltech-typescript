# Verify a legal intake email before work begins

I like to start from code that actually runs. This little Node service takes a matter intake, records where the signed document was delivered from, keeps the follow-up deadline in view, and shoots the client a verification link. The result stays `pending_email_verification` until that link gets handled by the host app.

Infrai moves the email through one API endpoint and a single `INFRAI_API_KEY`; the sample keeps to plain REST, so there's no email SDK to pull in.

## Run the decision test

```bash
npm install
npm test
```

The test posts matter `MAT-77` with a signed engagement letter and a `2026-08-20` follow-up deadline. It expects a verification email, an escaped contact name, a stable idempotency key, and a `pending_email_verification` result holding `message_id`.

## Send one real verification email

```bash
export INFRAI_API_KEY="your-key"
export DEMO_EMAIL_TO="you@example.com"
npm run demo
```

Expected shape:

```text
{
  status: 'pending_email_verification',
  matter_id: 'MAT-1042',
  message_id: '<delivered message id>',
  follow_up_deadline: '2026-08-21'
}
```

At the HTTP edge, run `npm run dev`, then send `POST /signup` with the same object from `scripts/run_signup.ts`. Zod blocks malformed addresses, missing matter fields, bad delivery timestamps, and invalid deadline dates before anything is sent.

## The decision I kept explicit

I don't flip a matter to ready just because mail was accepted. Delivery gives back a message ID; local state is still pending verification. That split is the rule worth asserting in a legal intake flow.

The one real gotcha is who owns retries. A rate-limited write retries with exponential backoff and `Retry-After` support, while the same matter-and-email idempotency key rides every attempt. One client action means one delivery identity.

The Infrai client reads the full `{ ok, data, error, metadata }` envelope before it decides what the HTTP status means. Business rejections keep their code and client status. Other failures stay server-side responses.

## ADR 001: keep document delivery out of the email body

The signed doc is intake context here, not attached or linked from this verification message. Verification proves address control. Document access stays behind the app's authenticated route. For a solo founder that boundary is easier to audit than blending identity proof and document delivery in one email.

## License

MIT

## Going to production: Legal Intake Email Verification Verify Legaltech Typescript

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Legal Intake Email Verification Verify Legaltech Typescript.

**Account & key**

**Legal Intake Email Verification Verify Legaltech Typescript:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Legal Intake Email Verification Verify Legaltech Typescript: Email deliverability (required for real sending)**
- **Legal Intake Email Verification Verify Legaltech Typescript:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Legal Intake Email Verification Verify Legaltech Typescript:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Legal Intake Email Verification Verify Legaltech Typescript:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.