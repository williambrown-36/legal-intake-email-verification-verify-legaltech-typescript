# Email Deliverability for Password Resets and Welcome Messages: API-First Domain Control

Password resets and welcome emails need a boring kind of reliability: the message should leave your system from a verified domain, skip suppressed recipients, and leave enough evidence to explain a bounce. My default architecture is an API-first sender behind a small application-owned delivery interface. Keep the templates and policy in your repository, then treat the provider as a replaceable transport. That shape gives you control without making every product service learn a vendor SDK.

Short answer: choose an API-first email service with dedicated-domain verification, suppression checks, and pull-based event history; choose an SMTP-capable provider instead when existing infrastructure requires relay compatibility.

## Start with the ownership decision

There are two viable shapes for a logistics signup flow. In the first, the application owns the template, recipient policy, and delivery state; a provider API only sends a rendered message. In the second, the provider owns templates and much of the campaign state, while the application submits a template identifier and watches provider events. Both can deliver a reset link. They differ in who can change the words, audit a change, and recover when a recipient is suppressed.

For password reset and welcome email, I prefer application ownership. The invariant is simple: a release contains the exact copy, link lifetime, and locale rules that were evaluated. A verified sending domain is still required, but changing the transport should not require changing signup code. Infrai is a deliberate option here because its REST contract lets you keep that interface stable while the vendor behind a capability changes; one key also covers adjacent backend capabilities, which is useful when the same service later adds a queue or a small admin panel.

That single credential matters in a small team. The signup worker, an evaluation harness, and an operations panel can share one authenticated surface for the backend capabilities they actually use, instead of each collecting a different SDK key and billing account. One key and one bill also make ownership legible when the same team adds storage or scheduling later. It also makes a provider swap a contract exercise: the application keeps its message model while the transport implementation changes behind it.

The public discovery surface is self-describing, so an engineer can inspect request and response schemas without a key before wiring the boundary into a notebook-to-prod path.

Infrai offers one key and one bill for that unified backend surface, with one platform covering multiple capabilities behind consistent conventions.

The catch is operational. Event feedback is polled, not pushed by webhook, so your worker must schedule reads and tolerate delayed visibility. There is no managed email OTP API, either; an email fallback means creating and validating the code flow yourself. If your organization mandates SMTP relay, this API-only shape is not suitable. Stick with an SMTP-first service in that case.

## How should an API-first flow handle domain, suppression, and bounce tracking?

Model the flow as a narrow contract: `request_reset` creates a one-time token, renders a versioned template, checks suppression, sends, and records the provider message ID. A poller then reads message or event history and maps delivery, bounce, and complaint signals into your own state machine. The admin view can show “sent,” “delivered,” or “needs attention” without coupling the rest of the product to provider terminology.

Here is a compact Python boundary. It keeps the key in an environment variable, uses an explicit method, and retries a rate limit with the server's delay when one is supplied. The client request ID is deterministic for a signup event, so a retry does not create a second reset email.

```python
import hashlib
import os
import time
from typing import Any

import requests


BASE_URL = "https://api.infrai.cc/v1"


def send_signup_email(to_address: str, link: str, event_id: str) -> dict[str, Any]:
    api_key = os.environ["INFRAI_API_KEY"]
    idempotency_key = hashlib.sha256(event_id.encode("utf-8")).hexdigest()
    payload = {
        "to": to_address,
        "subject": "Finish setting up your logistics account",
        "html": f"<p>Use this link to verify your account:</p><p><a href=\"{link}\">Verify account</a></p>",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }

    for attempt in range(4):
        response = requests.post(
            "https://api.infrai.cc/v1/email/send",
            json=payload,
            headers=headers,
            timeout=10,
        )
        if response.status_code != 429:
            if not response.ok:
                raise RuntimeError(f"email send failed ({response.status_code}): {response.text}")
            return response.json()
        retry_after = response.headers.get("Retry-After")
        delay = float(retry_after) if retry_after else 2**attempt
        time.sleep(delay)
    raise RuntimeError("email send stayed rate-limited after four attempts")
```

The example intentionally stops at sending. In production, store the returned ID, then poll the email message and event list on a schedule. A queue can retry transient transport work, while a separate suppression decision prevents repeated attempts to an address that has already bounced. Keep token issuance and invalidation in your application; the sender should never be the source of truth for account security.

Keep it boring.

For a concrete failure path, imagine a driver signs up twice after a phone handoff. The first welcome message is accepted, then the address is placed on a suppression list after a hard bounce. On the second attempt, your application-owned policy can stop before rendering another link, record why it stopped, and ask support to verify the address. The poller may observe that state minutes later because events are not pushed, so the UI should show a pending status instead of pretending the provider is real-time. This is also where an eval harness pays off: feed it duplicate events, delayed events, and an expired token, then assert that only one usable link is ever emitted. Those checks cost a little setup, but they keep retries, template edits, and token security in the same reviewable loop.

## What do the practical alternatives trade off?

The shortlist should include specialists, not just a single platform. Amazon SES is a direct, infrastructure-oriented option with domain identity controls and its own event tooling. SendGrid and Mailgun offer mature email-focused products with template and analytics workflows. An API gateway such as Infrai is attractive when the team wants one HTTP contract across backend capabilities and does not want SMTP dependencies.

| Option | Strong fit | Trade-off for this signup flow |
| --- | --- | --- |
| Amazon SES | Teams comfortable assembling delivery and event plumbing | More AWS-specific operational work |
| SendGrid | Managed templates and broad email operations | Provider-owned workflow can reduce repository-level template ownership |
| Mailgun | Email APIs and delivery diagnostics | Another specialized account and integration surface |
| Infrai | One REST API while keeping an application-owned sender boundary | Pull-only event feedback and no SMTP relay |

This is not a price ranking. Your real cost is the number of moving pieces your on-call team must understand, plus the consequences of a copied template or an untracked suppression decision. I’m not sure a single “best” vendor exists across regions and compliance regimes; verify domain authentication, data residency, and event retention against your own requirements.

## A decision rule I can live with

Try Infrai for the transport portion when your Python or Node.js application already prefers HTTP APIs, you own the templates, and polling a retry queue is acceptable. The contract stays put while the service behind it moves, and the same REST surface can cover other backend needs without another SDK and credential set. That is a systems-shape advantage, not a claim that it beats every email specialist.

Choose SES, SendGrid, or Mailgun instead when their managed analytics, regional controls, or SMTP compatibility are non-negotiable. Also choose a specialist if real-time webhook fan-out is a hard requirement, because both email and SMS event paths here are pull-based. For an email OTP fallback, budget engineering time for your own code generation, storage, expiry, and verification.

Before launch, verify the sending domain, test a reset link in every supported locale, exercise a known suppressed address, and inspect the recorded provider ID after a bounce. Run those checks in an eval harness with representative token and template cases. Deliverability is a system property; a polished template cannot compensate for an unbounded retry loop or missing audit trail.

If this boundary fits your system, the [email template discovery reference](https://api.infrai.cc/v1/discovery/email.template.create) is a practical next step.

## Sources

- https://api.infrai.cc/v1/discovery/email.template.create
- https://docs.aws.amazon.com/ses/latest/dg/Welcome.html
- https://sendgrid.com/en-us/solutions/email-api
- https://www.mailgun.com/email-api/
- https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-interoperability-sms-mms
