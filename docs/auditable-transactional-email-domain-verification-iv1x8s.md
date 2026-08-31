# Auditable transactional email: domain verification, DKIM rotation, and suppression

If your job is to send a compliance notice and prove months later that it reached a guardian, pick the transactional email path that hands you a machine-readable delivery record, and treat the rest of the API surface as the second question. Custom domain verification, DKIM rotation and suppression management are table stakes now; a small startup team can get all three from a hosted API or from a self-run mail server. The difference between a two-day integration and a two-week one is whether delivery evidence arrives as structured events you can store next to the student record, or as a dashboard someone has to screenshot.

That distinction is the whole decision axis for this kind of system, so the rest of this note walks the data flow, the DNS work, and the operational load that shows up after launch.

## What the audit record actually has to prove

An auditable notice answers five questions: what was sent, to whom, when, under which sending identity, and what the receiving side did with it. Most teams log the first three and stop.

The gap is the last two. Your application's "sent" log line is not evidence of anything — a `250` from SMTP or a `202` from an HTTP API only proves the message left your side. Delivery, bounce and complaint outcomes arrive later, asynchronously, over webhooks or bounce mailboxes, and if you don't persist them keyed to the same notice id, you have a send log rather than a delivery record. I'd store, per recipient: an immutable notice id, the rendered body hash, the template version, the sending domain and the DKIM selector in force at send time, the provider-side message id, and every subsequent status event with its raw payload. The body hash matters more than people expect. Templates get edited, and a year later "we sent the September policy notice" is a much weaker claim than "we sent this exact 4,812-byte document, sha256 `a3f1…`, to this address, and the receiving server accepted it at 09:14:22Z." Bounce classification belongs in that record too: RFC 3464 defines the delivery status notification format that carries the status code and diagnostic text, and the difference between a `5.1.1` unknown mailbox and a `4.2.2` full mailbox decides whether you retry or escalate to a second channel.

## How do you handle custom domain verification and DKIM rotation for transactional email?

The flow is short. Your app posts the notice to a sending API, the sender signs it with a DKIM key published under a selector on your domain, the receiving mail server validates SPF and DKIM and checks DMARC alignment against the visible From address, and the outcome comes back to you as an asynchronous event that you write into the audit table.

Domain verification is DNS work, and it is where the integration effort concentrates. You publish a TXT record proving ownership, a DKIM public key at `<selector>._domainkey.<domain>`, an SPF record, a DMARC policy at `_dmarc.<domain>`, and usually a CNAME for a custom return path so bounces come back to the sender rather than to your visible From domain. Send notices from a dedicated subdomain — `notices.school.example` rather than the apex — so a marketing campaign can never drag the reputation of a legal notification down with it. Watch the SPF lookup budget while you are in there: RFC 7208 caps the mechanisms that trigger DNS queries at ten per evaluation, and stacking three vendors' include statements is the usual way a startup blows through it and gets a permerror instead of a pass.

Rotation is the part that people postpone until it becomes an incident. DKIM keys are addressed by selector (RFC 6376), which makes rotation a publish-then-switch operation rather than a swap: publish the new key under `s2` while `s1` is still live, wait out the TTL of the old record, tell the sender to sign with `s2`, let in-flight and queued mail drain, then remove `s1`. Automate it on a schedule instead of doing it by hand, because the manual version is what leaves a retired key published for a year.

```python
import hashlib
import os
import time

import requests

SEND_URL = os.environ["MAIL_API_URL"]          # your provider or your own gateway
API_KEY = os.environ["MAIL_API_KEY"]
FROM_ADDR = "notices@notices.school.example"


def send_compliance_notice(db, notice_id, recipient, html, template_version):
    """Send one notice and persist enough evidence to defend it later."""
    if db.is_suppressed(recipient):
        # A suppressed address is not a silent no-op: it is an auditable outcome
        # that must trigger the documented fallback channel.
        return db.record(notice_id, recipient, status="suppressed", message_id=None)

    body_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
    payload = {
        "from": FROM_ADDR,
        "to": recipient,
        "subject": "Policy update - action required",
        "html": html,
        # Same key on every retry, so a timeout cannot produce a duplicate notice.
        "idempotency_key": f"{notice_id}:{recipient}",
    }

    for attempt in range(4):
        r = requests.post(
            SEND_URL,
            json=payload,
            timeout=10,
            headers={"Authorization": f"Bearer {API_KEY}"},
        )
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 ** attempt)            # backoff, then try the same key again
            continue
        r.raise_for_status()
        accepted = r.json()
        return db.record(
            notice_id,
            recipient,
            status="accepted",
            message_id=accepted["id"],          # provider id: joins the webhook events
            body_hash=body_hash,
            template_version=template_version,
            dkim_selector=os.environ["DKIM_SELECTOR"],
            accepted_at=accepted["created_at"],
        )
    raise RuntimeError(f"notice {notice_id} not accepted for {recipient}")
```

The webhook side is the other half, and it is boring on purpose: verify the signature, upsert the event by provider message id, never overwrite an earlier terminal state. Before any of that goes live, check the published records by hand once so you know what correct looks like.

```bash
dig +short s2._domainkey.notices.school.example TXT
dig +short _dmarc.school.example TXT
```

## Where the integration effort actually goes

Three delivery paths are realistic for this job, and they differ mostly in who absorbs the DNS and reputation work.

| Path | Integration effort | Delivery evidence | Ongoing ops |
| --- | --- | --- | --- |
| HTTP sending API | One HTTP call plus a webhook receiver | Structured events, joinable by message id | DNS records, selector rotation, webhook uptime |
| SMTP relay | Existing mail libraries keep working | Bounce mailbox parsing, DSN handling on you | Same DNS work plus DSN plumbing |
| Self-hosted mail server | Days to weeks | Full log control, nothing hosted for you | IP warm-up, blocklist monitoring, queue and patching |

For a compliance workflow the HTTP path usually wins on integration effort, and the trade-off is that your evidence quality is bounded by the event vocabulary the sender exposes. If your auditors need the raw SMTP conversation, the hosted path can't give you that, and you should stick with your own mail server despite the ops cost.

Suppression management is where this gets legally interesting rather than merely technical. A suppression list — hard bounces, complaints, explicit opt-outs — protects sender reputation, and any sane stack checks it before the send. A statutory notice, though, still has to reach the recipient. So the rule I'd write into the runbook is: never bypass suppression to force delivery, because that is how a domain gets blocklisted; instead treat a suppressed address as a routed exception that triggers a documented fallback and records the reason.

That fallback is frequently SMS, and it carries its own sharp edge. Carrier segmentation gives you 160 GSM-7 characters in a single message and 153 per part once a message is concatenated; a single non-GSM character — a curly apostrophe pasted in from a word processor — flips the encoding to UCS-2 and drops those limits to 70 and 67. A 300-character notice you thought was two segments becomes five, and truncation in a legal notice is a problem you do not want to discover from a parent's complaint.

## The cheap path and what it costs six months in

Cheap is a real constraint for a small team, and it's worth being precise about what the cheap options actually cost. Running your own mail server has almost no invoice and a large operational bill: IP warm-up, blocklist monitoring, queue management, TLS certificates, patching. The lowest-priced hosted plans usually economize on exactly the thing this project needs — shorter event retention, coarser bounce categories, fewer webhook event types — so the invoice is small and the evidence is thin. Deliverability is not a feature you can buy outright in any case; authentication, list hygiene and a gradual volume ramp do the work, and no API replaces that.

Since I ship evaluation harnesses for other systems, I default to one here too, and it pays for itself the first time DNS changes underneath you. Send a canary notice to seed addresses on several major mailbox providers on a schedule, then assert on the result rather than eyeballing it: `Authentication-Results` shows `dkim=pass` with the selector you expect, DMARC alignment holds, the webhook produced a delivered event within your SLA, and the audit row has every required column populated. Fail the build when an assertion breaks. That harness is maybe 200 lines and it catches the expired selector, the SPF permerror, and the webhook receiver that has been quietly returning a redirect for a week.

## Running it after launch

Weekly, read the DMARC aggregate reports rather than filing them: RFC 7489 defines the `rua` feedback loop precisely so you can see which sources are sending as you and whether alignment holds, and it is the only cheap way to find a forgotten system still mailing from your domain. Start at `p=none`, fix what the reports show, then tighten to quarantine and reject once your legitimate senders are aligned. Quarterly, rotate the DKIM selector and confirm the old record is gone. Monthly, export the suppression list into the audit store, so the record of why an address was skipped survives independently of the sending vendor. Alert on delivery rate per domain, not in aggregate, since one large mailbox provider deciding to defer your mail is invisible in a global average until it isn't. And once a year, actually run the retrieval path — pick a notice from eighteen months ago and reconstruct what was sent, to whom, and what happened to it. If that takes more than a minute, your audit record has a gap, and better to find it in a drill than in a dispute.

None of this is exotic. It's DNS, one idempotent HTTP call, an event table, and the discipline to keep them in sync — and the integration cost is dominated by the evidence path, not by the sending API you happen to choose.

## Sources

- [RFC 7489: Domain-based Message Authentication, Reporting, and Conformance (DMARC)](https://datatracker.ietf.org/doc/html/rfc7489)
- [RFC 6376: DomainKeys Identified Mail (DKIM) Signatures](https://datatracker.ietf.org/doc/html/rfc6376)
- [RFC 7208: Sender Policy Framework (SPF) for Authorizing Use of Domains in Email](https://datatracker.ietf.org/doc/html/rfc7208)
- [RFC 3464: An Extensible Message Format for Delivery Status Notifications](https://datatracker.ietf.org/doc/html/rfc3464)
- [Twilio: SMS character limits and segmentation (GSM-7 and UCS-2)](https://www.twilio.com/docs/glossary/what-sms-character-limit)
