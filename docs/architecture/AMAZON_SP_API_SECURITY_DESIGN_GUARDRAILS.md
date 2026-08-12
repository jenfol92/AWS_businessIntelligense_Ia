# Amazon SP-API Security & Compliance Design Guardrails

**Project:** ERP_BI_IA
**Purpose:** Mandatory design guardrails for any feature that accesses, stores, processes, transmits, derives, displays, or deletes data obtained from Amazon Services APIs / SP-API.

> This document is an engineering guardrail, not legal advice. When Amazon updates the Solution Provider Portal Agreement, Acceptable Use Policy (AUP), Data Protection Policy (DPP), Agent Policy, or API-specific terms, review this document and update the controls before continuing affected development.

## 1. Scope

Apply these guardrails to Amazon SP-API integrations, Finances API, reports, sales, inventory, orders, shipments, returns, scheduled imports, cron jobs, refresh-on-entry sync, background workers, agents, databases, caches, logs, backups, files, analytics models, UIs, APIs, RPCs and services that touch Amazon Information.

Do not assume a feature is out of scope merely because it runs internally.

## 2. Core design principles

### 2.1 Data minimization

Retrieve only the Amazon Information required for the ERP feature being implemented.

- Do not request SP-API roles "just in case".
- Do not retrieve PII unless the feature has an explicitly permitted need.
- Do not use Amazon data for purposes unrelated to the Authorized User's Amazon business.
- Do not aggregate Amazon data across unrelated Authorized Users.
- Do not expose Amazon-derived information to users who do not need it.

### 2.2 Least privilege and deny by default

- Use individual user identities; no shared/generic user accounts.
- Keep service-role/programmatic credentials server-side.
- RLS/API authorization must deny by default.
- Grant only the minimum permissions needed.
- Document ownership of service accounts and programmatic access.
- Review access at least quarterly.

### 2.3 Finance state separation

For Amazon finance:

- `PROJECTED` = estimate only.
- `CONFIRMED` = Amazon has closed/confirmed the settlement.
- `RECEIVED` = cash receipt has been explicitly confirmed and may affect cash.
- Never allow PROJECTED or CONFIRMED to silently create cash movements.
- Never double count the same canonical income across states.
- Keep source identity and reconciliation traceable.

### 2.4 Transparency of calculations and freshness

Any Amazon-derived estimate, model or automated calculation with material business impact must state:

- source data;
- formula/model;
- assumptions;
- data freshness / last successful sync;
- whether the result is estimated, confirmed or received;
- whether a fallback is being shown because Amazon is unavailable.

Never present stale, estimated or model-derived values as exact Amazon truth.

## 3. SP-API throttling and automation

All Amazon API clients must respect per-Authorized-User throttling quotas.

Mandatory:

- One canonical synchronization service per domain.
- Idempotent imports.
- Stable source keys / settlement IDs / report IDs.
- Database or distributed lock against concurrent syncs.
- Backoff for quota/throttling responses.
- Bounded retry count.
- No parallel retry storms.
- No multiple developer applications/accounts used to bypass quotas.
- No repeated SP-API request on every React render.
- Cache/freshness window where appropriate.
- If Amazon is unavailable, use last known persisted data when safe and expose a stale warning rather than hammering the API.

For `/finanzas/planificacion`, use:

`cron + freshness check + one canonical sync + persisted fallback`

not direct SP-API calls from the client.

## 4. Credentials and secrets

Never expose or hardcode LWA secrets/tokens, SP-API credentials, AWS credentials, Supabase service role, database passwords, `CRON_SECRET`, encryption/KMS keys, or session/authorization tokens.

Requirements:

- Secrets remain server-side.
- Stored credentials are encrypted at rest.
- Programmatic credentials are rotated at least every 12 months and immediately on suspected compromise.
- Do not print secrets to logs, snapshots or error responses.
- Do not commit `.env*` secrets.
- Do not paste credentials into tickets, prompts, docs or source files.
- Prefer managed secret storage in deployed environments.
- Maintain an inventory of active credentials and owners.

## 5. Network and application protection

For public/internet-facing deployments handling Amazon Information:

- Network firewall / ACL controls.
- WAF or equivalent application-layer protection for all public endpoints.
- Segmentation of sensitive environments where practical.
- IDS/IPS or equivalent controls appropriate to the environment.
- TLS 1.2+ for Amazon Information in transit.
- No publicly exposed database/admin ports.
- No direct exposure of service-role endpoints to untrusted clients.
- Maintain network architecture documentation and evidence of controls.

## 6. Endpoint and workstation controls

Devices that access/process/store Amazon Information must use:

- storage encryption;
- endpoint protection / anti-malware / EDR or equivalent;
- automatic updates where supported;
- screen lock after no more than 15 minutes inactivity;
- restricted administrative access;
- controls preventing users from disabling endpoint protection;
- no unmanaged/personal device access unless centrally managed with equivalent controls.

## 7. Authentication and access lifecycle

Application/account access must support:

- MFA for user accounts.
- Password policy where passwords are used:
  - at least 12 characters;
  - complexity requirements;
  - password history preventing reuse of last 10;
  - minimum age 1 day;
  - maximum expiration 365 days.
- Account lockout after no more than 10 consecutive failed logins.
- Monitoring for anomalous login activity.
- Unique identities per person.
- Access removal within 24 hours of termination or role change.
- Annual security/data-protection training for personnel with access.
- Quarterly access reviews with retained evidence.

When using Supabase/Auth, verify the deployed authentication configuration satisfies these requirements; do not assume defaults do.

## 8. PII controls

If any Amazon PII is retrieved or stored, treat the entire datastore containing it as in-scope for stricter PII requirements.

### 8.1 Permitted purpose

Amazon Customer PII must only be used for permitted purposes such as merchant-fulfilled shipping or applicable legal/tax requirements.

Do not use Amazon customer PII for marketing, review manipulation, unrelated profiling, cross-customer data products, or training/developing AI/ML models.

### 8.2 Retention

- PII should normally be retained no longer than 30 days after order delivery unless law requires longer.
- Legal/tax retention must be documented and purpose-limited.
- Deletion triggered by authorization revocation, Amazon request, loss of authorization or service termination must be completed within 30 days unless legally required otherwise.

### 8.3 Encryption

- PII at rest: at least AES-128 or RSA-2048 equivalent/higher.
- Use managed key lifecycle / KMS or equivalent.
- Keys must not be stored beside encrypted data without protection.

## 9. Data origin and traceability

Amazon Information stored in shared databases must be attributable to its origin.

Prefer canonical source identifiers such as:

- `settlement_id`;
- report/document ID;
- Amazon order ID;
- marketplace ID;
- source key;
- sync run ID.

For financial data, preserve:

`Amazon source → canonical financial row → reconciliation → state transition → cash movement (only if RECEIVED)`.

Avoid indefinite retention of unnecessary full raw payloads.

## 10. Logging and monitoring

Log security-relevant events without leaking secrets or unnecessary PII:

- authentication success/failure where appropriate;
- sync start/end;
- Amazon API errors and throttling;
- data changes;
- suspicious access;
- application/system failures.

Requirements:

- protect logs from unauthorized access/tampering;
- retain required security logs for at least 12 months unless law requires otherwise;
- review in real time via monitoring/SIEM where available, or at least every 2 weeks;
- alert on suspicious access, unexpected request rates, unusual retrieval volume and repeated unauthorized calls.

## 11. Incident response

Maintain an incident response plan/runbook with:

- Incident Management Point of Contact (IMPOC);
- incident types affecting Amazon Information;
- detection/escalation paths;
- containment/remediation;
- evidence handling;
- Amazon notification procedure;
- regulatory notification procedure where applicable;
- post-incident corrective actions.

According to the supplied DPP, Amazon security incidents must be notified within 24 hours of detection.

Review the incident plan at least every 6 months and after major system/infrastructure changes.

## 12. Deletion and retention by design

Every new table/field storing Amazon Information must answer:

1. Why is this data needed?
2. What is its source?
3. How long is it retained?
4. What triggers deletion?
5. How is it securely deleted?
6. How are backups handled?
7. Is there a legal/tax retention exception?

Do not build indefinite retention by default.

## 13. Secure coding and environment separation

- No hardcoded secrets.
- Separate test/local and production environments.
- Validate Amazon payloads before business-critical use.
- Validate currency, amount, state, dates and canonical identifiers.
- Treat unexpected payloads as errors, not values to "make fit".
- Do not invent settlement amounts or marketplace attribution.
- Do not silently coerce invalid/unknown values to zero when business meaning changes.
- Make financial writes idempotent.
- Prefer fail-safe/read-only degradation over unsafe automatic writes.

## 14. Vulnerability management

Maintain a vulnerability management runbook.

Minimum cadence from the supplied DPP:

- vulnerability scanning at least every 30 days;
- change-triggered scanning after significant changes;
- code vulnerability scanning before each release;
- penetration testing at least every 365 days.

Pen test scope must cover relevant network boundaries, cloud configuration, web apps, APIs, databases/storage, access control and system configuration.

Remediation targets:

- Critical: within 7 days.
- High: within 30 days.

Keep evidence of findings and remediation.

## 15. Backups, resilience and continuity

- Encrypt backups containing protected data.
- Control access to backups.
- Maintain and test restore procedures.
- For in-scope PII, maintain geographically separated backup/secondary capability as required by the supplied DPP.
- Define RTO/RPO.
- Do not treat a local dump containing Amazon Information as a harmless development artifact.

## 16. Third parties and subcontractors

Before a third party accesses Amazon Information:

- perform due diligence;
- ensure written obligations at least as strict as ours;
- document what is shared and why;
- disclose where required;
- review third-party risk at least annually.

This includes cloud, monitoring, support, contractors and AI/service providers that receive Amazon Information.

## 17. AI and automated agents

The August 2026 Solution Provider Portal Agreement defines an "Agent" as software/service taking autonomous or semi-autonomous action on behalf of a person/entity.

Therefore:

- ERP automation interacting with Amazon may need assessment against Amazon Agent Policy.
- Automated systems must identify themselves where Amazon requires it.
- If Amazon requests an Agent to stop, access must stop.
- Do not use Amazon Materials or Amazon confidential data to directly/indirectly develop or improve large language, multimodal or machine-learning models.
- Do not send Amazon Information to an AI provider unless the use is clearly permitted, necessary, contractually protected and policy-compliant.
- AI outputs with material business impact require data integrity/validation checks.
- Explain model/calculation accuracy and freshness to users.

## 18. Business-critical automation safeguards

For features that materially affect orders, finance, inventory, pricing, logistics or account management:

- validate source data before acting;
- preserve audit trail;
- require explicit confirmation for irreversible/high-impact actions unless separately approved;
- implement idempotency;
- use dry-run/read-only diagnostics for migrations and repairs;
- do not turn warnings into silent success;
- distinguish estimated vs confirmed vs executed state;
- fail safely if Amazon data is incomplete or ambiguous;
- do not submit frivolous/non-compliant support contacts or automated requests.

## 19. Amazon feature change-management gate

Before merging/deploying an Amazon-related feature, answer:

### Data
- What Amazon data is accessed?
- Is every field necessary?
- Does it contain PII?
- Where is it stored?
- How is Amazon origin tagged?
- What is the retention/deletion rule?

### Security
- Is access least privilege?
- Are credentials server-side and encrypted?
- Is TLS used?
- Does any endpoint require WAF/protection?
- Are logs free of secrets/PII?
- Are authentication requirements satisfied?

### API behavior
- Does it respect throttling?
- Are retries bounded?
- Is there a lock against concurrent imports?
- Is the operation idempotent?
- Is stale fallback preferable to repeated calls?

### Financial/data integrity
- Are estimated/confirmed/received states separate?
- Can the same source be double counted?
- Are invalid amounts rejected instead of coerced?
- Can an Amazon outage create unsafe writes?
- Is source identity auditable?

### Compliance operations
- Is deletion possible?
- Is the data inventory updated?
- Does incident response cover the feature?
- Does vulnerability-scan scope include it?
- Does the feature require a new security scan?
- Are third parties/subcontractors involved?

If any answer is unknown, classify the feature as **COMPLIANCE REVIEW REQUIRED** before production deployment.

## 20. Required Codex/AI instruction for Amazon work

Use this block whenever requesting implementation or review of Amazon/SP-API functionality:

> AMAZON SP-API COMPLIANCE GUARDRAIL
>
> This project is subject to Amazon's Solution Provider Portal Agreement, Acceptable Use Policy and Data Protection Policy.
>
> Before implementing any Amazon/SP-API feature:
>
> 1. Read `docs/compliance/AMAZON_SP_API_SECURITY_DESIGN_GUARDRAILS.md`.
> 2. Identify all Amazon Information/PII touched by the change.
> 3. Apply data minimization and least privilege.
> 4. Keep Amazon credentials server-side, encrypted at rest, and out of logs.
> 5. Respect Amazon throttling; do not implement quota circumvention.
> 6. Use bounded retry/backoff and concurrency locks.
> 7. Keep imports/writes idempotent.
> 8. Preserve source attribution and auditability.
> 9. Do not silently coerce invalid Amazon data into valid business values.
> 10. Distinguish estimated, confirmed and executed/received states.
> 11. Do not let an Amazon API failure corrupt/delete previously valid persisted data.
> 12. Do not expose Amazon Information without need-to-know authorization.
> 13. Do not hardcode or print credentials, tokens or PII.
> 14. Identify retention/deletion requirements for new Amazon data.
> 15. Assess whether the change alters public attack surface and therefore WAF, vulnerability scan or pentest scope.
> 16. If the feature uses autonomous/semi-autonomous behavior, assess it against Amazon Agent Policy before production.
>
> Before declaring PASS, report:
>
> - Amazon data accessed;
> - whether PII is involved;
> - permissions/roles required;
> - credential handling;
> - throttling/retry/concurrency behavior;
> - idempotency identity;
> - source attribution;
> - retention/deletion impact;
> - logging/monitoring impact;
> - public endpoint/WAF impact;
> - vulnerability-management impact;
> - compliance gaps or assumptions.
>
> Do not weaken these requirements merely to make a feature work.

## 21. Policy update procedure

Review authoritative policy sources whenever Amazon announces a change and before relevant production releases.

Track at minimum:

- Amazon Solution Provider Portal Agreement.
- Amazon Acceptable Use Policy.
- Amazon Data Protection Policy.
- Amazon Agent Policy.
- API-specific policies/terms.
- Amazon SP-API policies and agreements page.

When policies change:

1. Save/version the reviewed policy date.
2. Compare changes against this guardrail.
3. Create a compliance gap report.
4. Update engineering controls/runbooks.
5. Run change-triggered vulnerability/security review where applicable.
6. Record evidence/approval before production rollout.

## 22. Current policy baseline

Baseline supplied for this project:

- Acceptable Use Policy: August 2026 context.
- Amazon Solution Provider Portal Agreement: Version August 2026.
- Data Protection Policy: August 2026 update context.
- Effective policy-change date communicated by Amazon: **25 August 2026**.
- Amazon states the English version is the definitive legal version.

## Engineering status labels

Use these labels in future Amazon reviews:

- **COMPLIANT** — requirement demonstrably satisfied.
- **PARTIAL** — some controls exist but evidence/coverage is incomplete.
- **MISSING** — required control not implemented.
- **NOT APPLICABLE** — requirement genuinely does not apply; explain why.
- **UNKNOWN** — insufficient evidence; must not be treated as compliant.
- **BLOCKER** — must be resolved before production use.
