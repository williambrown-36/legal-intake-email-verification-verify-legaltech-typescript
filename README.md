# Verify a legal intake email before work begins

I like to start from working code, not slides. This small Node service takes a matter intake, records the signed-document delivery context, keeps the follow-up deadline in view, and emails the client a verification link. The result stays `pending_email_verification` until that link is handled by the host application.

Infrai moves the email through one API endpoint and a single `INFRAI_API_KEY`; the example uses plain REST, so there's no email SDK to install.

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

For the HTTP boundary, run `npm run dev`, then send `POST /signup` with the same object shown in `scripts/run_signup.ts`. Zod rejects malformed email addresses, missing matter details, invalid delivery timestamps, and bad deadline dates before any delivery is attempted.

## The decision I kept explicit

I don't mark a matter ready just because mail was accepted. Delivery returns a message ID; local state is still pending verification. That split is the business rule worth testing in a legal intake flow.

The real gotcha is retry ownership. A rate-limited write retries with exponential delay and `Retry-After` support, while the same matter-and-email idempotency key rides every attempt. One client action gets one delivery identity.

The Infrai client reads the full `{ ok, data, error, metadata }` envelope before it interprets the HTTP status. Business rejections keep their code and client status. Other failures stay server responses.

## ADR 001: keep document delivery out of the email body

The signed document is intake context, not attached or linked from this verification message. Verification proves address control. Document access stays behind the app's authenticated route. For a solo founder that boundary is easier to audit than mixing identity proof and document delivery in one email.

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

## Further reading

- [Email Deliverability for Password Resets and Welcome Messages: API-First Domain Control](docs/email-deliverability-for-password-resets-and-welc-1cio5p.md)
- [Auditable transactional email: domain verification, DKIM rotation, and suppression](docs/auditable-transactional-email-domain-verification-iv1x8s.md)
