# Inventory Ledger contract repair (local preparation)

## Frozen deployed baseline (audited 2026-08-14)

Supabase currently has the original `amazon_fba_inventory_ledger_daily`
schema from `amazon_fba_inventory_ledger_daily.sql`. It does **not** have
`msku_aliases`, `condition_type`, or `report_document_id`. Its unique key is
`sku_original/fnsku/asin/snapshot_date/disposition/location/source`.

`v_latest_fba_inventory_by_product_country` is the 20260714 legacy view with
the ten-column contract ending in `dispositions`, `is_stale`, `stale_days`.
The consolidated migration deliberately leaves it unchanged.

## Contracts

- Operational EU/UK availability comes only from canonical Inventory
  Summaries pools. Ledger is physical distribution, reconciliation and audit.
- Ledger quantitative grain is document identity + date + ASIN + FNSKU + raw
  location + disposition + condition. Seller SKUs are aliases/provenance.
- `location_raw` is never replaced. Classification is explicit and evidence
  driven. Unknown FC country stays null.
- General `sellable` includes every SELLABLE row. Condition subtotals are
  additional dimensions and never hide unknown-condition sellable stock.

## Document identity

- Reports API: `REPORT_DOCUMENT_ID`, `report:<reportDocumentId>`.
- Future manual import: `MANUAL_SHA256`, `manual:<sha256(content)>`, with the
  bare digest in `manual_document_hash`.
- Historical rows whose bytes are unavailable: `LEGACY_SOURCE_FILE` with a
  deterministic weak identity. This is explicitly not represented as a hash
  of file content and is reported by the precheck.

## Location enrichment

Active codes from the existing `paises` table are COUNTRY, including physical
countries such as CZ even when no commercial marketplace exists. A non-country location becomes FC only
when corroborated by persisted evidence such as inbound destination center.
Country enrichment is accepted only when that evidence yields one consistent
country. Other values remain OTHER; raw values such as MAD6 are preserved.

## Controlled future sequence

1. Run the read-only remote precheck.
2. Review every BLOCK and REVIEW result.
3. Take a database backup.
4. Apply the consolidated migration once in a controlled transaction.
5. Verify schema, legacy view and new location view.
6. Run one controlled commit.
7. Only later create the Ledger schedule and request a fresh report.
