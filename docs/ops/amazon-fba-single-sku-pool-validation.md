# Amazon FBA single-SKU marketplace validation

## Purpose and boundaries

This diagnostic gathers operational-equivalence evidence for one Seller SKU in
one marketplace. It does not establish physical location or Pan-European pool
membership by itself. It never persists canonical inventory and never invokes
inbound, Ledger, Reports, cron, or the canonical refresh.

The route is disabled in production. Do not invoke it until a live request is
separately authorized.

## ALAIA evidence already persisted

Persisted sources currently expose these ALAIA identities for ASIN
`B0DJBQGKBT`:

| Seller SKU | FNSKU value | Persisted marketplaces/locations | Relationship to the other identity |
| --- | --- | --- | --- |
| `f8436616610104` | `X00259GEWP` | DE, GB | `UNKNOWN` |
| `f8436616610104UK` | `B0DJBQGKBT` | GB | `UNKNOWN` |
| `Amazon.Found.B0DJBQGKBT` | `B0DJBQGKBT` | GB | `UNKNOWN` |

The same ASIN does not prove that these are the same inventory. The latest
persisted BY_COUNTRY report (2026-07-21) contains 213 units for both
`f8436616610104UK` and `Amazon.Found.B0DJBQGKBT`, with the same ASIN-shaped
FNSKU; this exact equality also repeats in earlier reports. That is strong
duplicate-representation evidence, but it is not enough to classify the units
as `PROVEN SAME INVENTORY REPRESENTATION` without Amazon identity/label-owner
evidence. The `UK` suffix and ASIN-shaped FNSKU may be consistent with
marketplace-specific or manufacturer-barcode handling, but the persisted data
does not prove that cause. All pairwise relationships therefore remain
`UNKNOWN`; do not sum or deduplicate these identities.

The initially requested Seller SKU is `8436616610104`. Persisted Amazon report
rows use prefixed Seller SKUs, so a zero-row response for the unprefixed value
would be an identity finding, not evidence of zero inventory. A later test of
the persisted Seller SKU candidates must be separately authorized.

## Future ALAIA ES/DE live test (not executed)

Each GET below is an independent operation and performs exactly one
`getInventorySummaries` HTTP request:

```text
GET /api/diagnostics/sp-api/inventory-summary?marketplace=ES&sellerSku=8436616610104
GET /api/diagnostics/sp-api/inventory-summary?marketplace=DE&sellerSku=8436616610104
```

Save both JSON results. Then compare them without Amazon access:

```text
POST /api/diagnostics/sp-api/inventory-summary
{ "a": <ES result.result>, "b": <DE result.result> }
```

Amazon's published default usage plan is 2 requests/second with burst 2, which
implies a 500 ms steady-state interval. Because this account has just returned
429 without an observed limit or Retry-After, use a minimum 1,000 ms separation
(two default refill intervals), only after the existing application cooldown
has expired and while no other SP-API work is running. This is a conservative
test policy, not a guarantee of account quota availability.

There is no automatic retry for 429, 403, 5xx, or an expired LWA access token.
If Amazon returns `nextToken`, the result is `UNEXPECTED_PAGINATION`; the token
is not followed.

Expected result fields are marketplace, Seller SKU, ASIN, FNSKU, fulfillable,
reserved components, inbound components, unfulfillable, researching, total,
last-updated time, pagination presence, safe rate-limit metadata, and exactly
one HTTP-call count. Comparison returns `IDENTICAL`, `DIFFERENT`, or
`INCOMPLETE`, with differences at exact ASIN/Seller-SKU/FNSKU identity. ASIN
groups are listed but never summed.

## Smallest follow-up sample if ALAIA ES/DE is identical

Do not download catalogs. Select 4-6 representative Seller SKU identities from
persisted data: high stock, low stock, reserved, inbound, and zero/near-zero.
For each chosen identity, query only the minimum marketplace pair needed to add
an untested boundary:

1. ES vs FR (continental core).
2. ES vs IT (continental core).
3. DE vs PL (eastern EU boundary).
4. DE vs SE (Nordic boundary).
5. One established continental marketplace vs GB (separate-pool hypothesis).

Each pair remains two independent requests. Identity equality across several
representative SKUs is operational-equivalence evidence; it is not physical
location evidence and does not alone prove contractual pool membership.

## Full-catalog pagination pacing proposal (not implemented)

The official `nextToken` lifetime is 30 seconds. For a future canonical run:

- derive the interval from `x-amzn-RateLimit-Limit` when present;
- otherwise use the published 2 requests/second default (500 ms token interval);
- apply a 1,000 ms conservative page interval after the recent 429;
- never run another marketplace or page after a 429 without Retry-After;
- when Retry-After is present, respect it, but abort the snapshot if waiting
  would make the 30-second nextToken unsafe rather than replaying an expired page;
- persist page/call/marketplace metadata and retain the existing request budget;
- re-evaluate pacing only from observed headers and successful controlled runs.

This proposal deliberately does not change canonical pagination, snapshot grain,
pool identity, Planner, Finance, or shared-pool semantics.
