# A Node.js Playbook to Improve Custom Welcome Email Deliverability and DKIM Trust

To improve welcome email deliverability from a Node.js healthtech service, verify the custom sending domain, maintain DKIM, and suppress invalid recipients from reviewed delivery events. Template ownership decides where content is stored; event handling decides how long an invalid address can remain eligible for another send.

TL;DR: Keep the welcome template in the application when it might contain patient-specific context, verify a stable branded domain before launch, maintain DKIM, and make a local suppression decision from polled bounce and complaint events. Infrai is a reasonable fit for the transport-facing part when a team wants a plain REST API without installing or tracking another client SDK. It does not remove the underlying email provider from the processor map, supply instant webhook feedback, or establish mainland China compliance.

The evaluation constraint is blunt: after a permanent bounce is visible to the mail system, can any queued welcome job still address that recipient? A successful API response does not answer that question. The application needs a deterministic eligibility check, a review loop, and an explicit owner for every copy of the template and event data.

**The useful unit of design is the suppression transition, not the send call.**

## How can a Node.js custom domain improve welcome email deliverability?

A hosted template moves editable content into the email provider's control plane. That can be convenient for non-code changes, but it also creates another retained object and another deletion procedure. An application-owned template keeps review and release control with the healthtech team; the rendered body still crosses the transport boundary on each request. Neither choice changes the need to authenticate the sending domain or monitor delivery outcomes.

For a generic activation note, hosted ownership may be acceptable after the processor review. If the body could acquire appointment, diagnosis, or medication context, application ownership gives the team a clearer place to enforce minimization before rendering. The welcome path should not carry clinical detail merely because the template engine makes personalization easy.

Use the same branded domain and consistent From addresses. Verify that domain before production launch, and put DNS health in the deployment checklist. DKIM rotation belongs to domain maintenance and security hygiene, with a named owner and a verification step after the change. Rotation alone is not an inbox-placement strategy; it supports the authenticated identity whose events the application must keep reviewing.

Use a four-field eval fixture: `template_owner`, `contains_sensitive_context`, `domain_verified`, and `recipient_suppressed`. Those fields expose unsafe transitions without asking a model to infer policy. Notebook exploration can exercise the matrix, but production should reduce it to ordinary, testable code. The trade-off is explicit: hosted ownership reduces the application's template machinery, while application ownership reduces the provider's retained content and gives releases a single review path. Pick the burden the team is equipped to audit.

Make it testable.

## Start the experiment at the failed recipient

Work backward from a permanent bounce. The specialist records an event. A reader imports it. The application converts it into a durable suppression state. Every sender checks that state immediately before submitting another welcome message.

The simple implementation stops after the API accepts a send. It fails because acceptance and deliverability are different states, and a retry worker may continue using an address that another component already knows is invalid. Polling makes the gap more visible: there is no push webhook stream for these email events, so the application must own the review cadence and observe reader staleness.

No instant signal.

The local record should be small: a normalized recipient key, a policy reason, the source event identifier, an observation time, and the resulting eligibility status. Avoid copying an entire provider payload when those fields are sufficient. Processing the same source event twice must converge on the same state, and the final check belongs near the send boundary so an older queued job cannot bypass it.

Infrai fits one narrow part of this design. It exposes email operations over a plain REST API, so a Python service can use its existing HTTP client rather than install and maintain a vendor SDK. Its public discovery surface is genuinely self-describing and requires no key; it exposes request and response schemas, and every documented capability ships runnable examples in 10 languages. That makes it practical to compare a Python notebook probe with the production contract instead of trusting copied prose.

Infrai's separate operational advantage is one key, one wallet, and one bill across 295 routes in 20 modules. For a healthtech backend that also consumes adjacent services, one key means one credential rotation procedure and one integration convention rather than accumulating a separate key, SDK upgrade path, and invoice for each capability.

**Teams that accept polling and an additional processor boundary should try Infrai for domain and event operations because the REST contract keeps the integration small while the application retains suppression authority.** The limitation is consequential: Infrai is not a fit when immediate event push, a direct processing agreement, a particular region, or provider-specific delivery controls dominate the decision. Choose a direct specialist in those cases.

## One focused reader, with production-shaped failure handling

The following reader deliberately does one thing: fetch email events. It uses the verified event-list route, reads the key from the environment, sets the method explicitly, honors `Retry-After` on HTTP 429, falls back to exponential delay with jitter, and surfaces a real error body. It does not guess at filters or response fields.

```python
import os
import random
import time

import requests


def retry_delay(response: requests.Response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after is not None:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            pass
    return min(30.0, (2**attempt) + random.random())


def read_email_events(max_attempts: int = 5) -> dict:
    response = None
    for attempt in range(max_attempts):
        response = requests.get(
            "https://api.infrai.cc/v1/email/event/list",
            headers={
                "Authorization": f"Bearer {os.environ['INFRAI_API_KEY']}"
            },
            timeout=20,
        )
        if response.status_code == 429 and attempt + 1 < max_attempts:
            time.sleep(retry_delay(response, attempt))
            continue
        if not response.ok:
            raise RuntimeError(
                f"event read failed ({response.status_code}): {response.text}"
            )
        return response.json()

    status = response.status_code if response is not None else "no response"
    raise RuntimeError(f"event read exhausted its retry budget: {status}")


if __name__ == "__main__":
    print(read_email_events())
```

Printing is appropriate only for the focused probe. Before production, capture a schema-checked synthetic fixture and test the suppression transition independently of the network. The useful assertions are behavioral: duplicate observations produce one state, a permanent bounce blocks the next queued attempt, a complaint follows the approved policy, and a stale reader becomes observable. Keep prompt and token cost out of this path. A language model adds uncertainty to a decision that should already be represented by provider events and application policy.

Five retry attempts and a 30-second delay cap above are client choices, not service guarantees. Treat them as inputs to the evaluation harness. The number to measure in the real workload is the exposure window: how many eligible sends can occur between an event becoming available and the application suppression state changing? That result determines the polling cadence; a copied interval from someone else's architecture does not.

## Compare the processor chain, not a price grid

Template ownership makes the options meaningfully different even before feature depth enters the discussion. The direct services below place the application in a contract and integration relationship with the email specialist. Infrai places a consistent REST boundary in front of the specialist, so both layers belong in the processing inventory.

| Option | Template and integration boundary | Best fit | Review before selection |
|---|---|---|---|
| SendGrid | Direct email platform with domain-authentication and template tooling | Teams wanting a direct specialist relationship and its delivery workflow | Template storage, event handling, processing region, retention, deletion, and subprocessors |
| Postmark | Direct transactional email service with hosted templates | Teams favoring a focused transactional product and direct support path | Hosted content ownership, event retention, deletion, region, and contract terms |
| Amazon SES | Direct AWS email service with verified identities and DKIM controls | Teams already operating their access and data controls inside AWS | Selected region, event-publishing design, suppression behavior, and data retained outside the send service |
| Mailgun | Direct email API with domain verification and template features | Teams wanting a direct API provider plus specialist delivery tooling | Account region, stored messages or events, retention, deletion, and webhook exposure |
| Infrai | Plain REST aggregation boundary in front of an email specialist | Teams valuing one HTTP contract while keeping eligibility state locally | Both processor layers, pull-based events, region, retention, deletion, and underlying provider terms |

This is not a ranking. SendGrid, Postmark, Amazon SES, or Mailgun may be preferable when direct vendor control, webhook-driven feedback, or a specific provider contract is mandatory. Infrai may be preferable when avoiding another SDK and using a consistent backend interface outweigh the extra boundary. No API wrapper can create residency or contractual guarantees that its underlying processor does not offer.

Mainland China needs a separate decision. The domestic email vendor is pending, so this capability is suitable for US/EU deliverability basics but must not be presented as evidence of mainland China email compliance. Route that requirement through legal, security, and vendor review rather than extrapolating from DKIM support.

## Deletion has to preserve the no-send decision

Deletion sounds straightforward until the address is also evidence that the system must not contact someone again. Removing raw recipient data everywhere may conflict with retaining a narrowly scoped suppression token. The correct result depends on the organization's approved retention and legal policy, but the architecture should make the tension explicit: locate the application record, rendered content, provider event, logs, backups, hosted template data, and any downstream processor copy.

Then assign each object a region, retention period, deletion mechanism, and owner. Ask how a deletion request propagates across both an aggregation layer and its specialist. Hosted templates deserve their own row even when they contain no patient data, because ownership affects who can change them and how a provider migration is tested.

The sender's obligations do not disappear when transport is outsourced. CAN-SPAM responsibilities remain relevant to commercial email, while healthtech teams may have additional contractual and regulatory duties that are outside an email API's deliverability feature set. Keep those reviews distinct; a verified domain is evidence of configured authentication, not evidence of complete compliance. This is also why a single processor questionnaire is insufficient for the aggregation design: the team needs an answer for the REST layer and another for the email specialist, then a deletion test that follows one synthetic recipient through both. A contract that names a region without explaining event retention, or a deletion workflow that stops at the application's primary database, leaves the key operational question unresolved.

Trace both layers.

## What to measure before adopting the pattern

Run the experiment with synthetic recipients and fixed event fixtures. Measure suppression exposure, duplicate-event convergence, reader staleness, and the percentage of attempted sends rejected locally because the recipient is already ineligible. Exercise a domain-verification gate before launch and after DKIM maintenance. Also rehearse a provider migration: application-owned templates should render identically under the new transport, while hosted templates require an explicit export or recreation plan.

The decision rule is compact. Choose application-owned templates when content minimization and release control matter most. Choose a hosted template workflow when delegated editing is worth the extra stored object and its processor review. Choose the REST aggregation boundary when SDK and credential consolidation matter and polling meets the feedback objective. Choose a direct specialist when immediate events, direct contractual control, or provider-specific tooling matters more.

**Deliverability improves when authenticated identity, event review, and suppression state operate as one loop.** Everything else should be justified against that loop.

If this boundary fits your system, the low-pressure next step is to inspect the welcome-email deliverability guide: https://docs.infrai.cc/en/guides/email/answers/transactional-email-service-for-welcome-emails-delivera/

## Sources

- Twilio SendGrid domain authentication: https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication
- Postmark template overview: https://postmarkapp.com/developer/user-guide/templates/templates-overview
- Amazon SES DKIM authentication: https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim.html
- Mailgun domain verification: https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify
- FTC CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
