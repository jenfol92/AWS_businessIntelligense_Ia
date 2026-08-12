# FBA Inventory Ledger: sellable vs panel

## Scope

This audit covers FBA stock by country/location in Inventory. It does not cover
FBA sales, Stockagile, All Orders, forecast logic, or destructive migrations.

Reference product:

- Product id: `614e8e63-b23a-4c4f-8915-abf19a86702f`
- ASIN: `B0DJBQGKBT`
- Base SKU pattern: `8436616610104`

## Amazon ledger visible in the user capture

Visible SELLABLE rows from Inventory Ledger dated 2026-07-13:

| Location | FNSKU | SKU | Ending balance |
| --- | --- | --- | ---: |
| GB | X00259GEWP | f8436616610104 | 175 |
| DE | X00259GEWP | f8436616610104 | 358 |
| GB | B0DJBQGKBT | Amazon.Found.B0DJBQGKBT f8436616610104UK f8436616610104-combinado sin etiqueta | 220 |

Expected SELLABLE:

| Location | Sellable units |
| --- | ---: |
| GB | 395 |
| DE | 358 |
| Total | 753 |

Visible unsellable rows:

| Location | Disposition | Units |
| --- | --- | ---: |
| ES | WAREHOUSE_DAMAGED | 1 |
| ES | CUSTOMER_DAMAGED | 2 |
| IT | DEFECTIVE | 2 |
| IT | CUSTOMER_DAMAGED | 1 |
| GB | DEFECTIVE | 1 |
| GB | CUSTOMER_DAMAGED | 1 |
| PL | CUSTOMER_DAMAGED | 1 |

Expected unsellable total: 9. Expected physical total: 762.

## ERP panel before the fix

The panel showed the country rows from `inventario_paises.stock_fba`:

| Country | Panel FBA |
| --- | ---: |
| GB | 385 |
| DE | 348 |
| FR | 7 |
| ES | 3 |
| PL | 1 |
| Total | 744 |

## Source of the mismatch

The Inventory country table was built from `inventario_paises`:

- Source table: `inventario_paises`
- FBA column: `stock_fba`
- Country column: `pais`

The ledger import writes to `amazon_fba_inventory_ledger_daily` and the
consolidated view `v_product_fba_stock_daily`. The ledger import explicitly does
not update `inventario_paises.stock_fba`; that table can therefore remain a
persisted auxiliary/legacy country distribution.

The global operational stock already had access to latest ledger totals through
`get_latest_fba_ledger_stock_by_products`, which sums `v_product_fba_stock_daily`
by product and latest `snapshot_date`. However, the country table did not read
latest ledger by physical `location`.

Later diagnosis confirmed that the ledger rows currently available in the ERP
for product `614e8e63-b23a-4c4f-8915-abf19a86702f` are stale:

| ERP ledger snapshot | Location | SELLABLE |
| --- | --- | ---: |
| 2026-06-16 | DE | 593 |
| 2026-06-16 | GB | 223 |

The Amazon screenshot is from 2026-07-13, so those ERP values are not the
current Amazon ledger. The missing step is importing/matching the 2026-07-13
ledger into `amazon_fba_inventory_ledger_daily`.

## Why FR = 7 is suspicious

The visible Amazon ledger rows do not show a physical location `FR` for this
product on 2026-07-13. A panel row `FR = 7` is therefore likely coming from
persisted `inventario_paises.stock_fba`, not from the latest ledger location
snapshot.

The diagnostic SQL `sql/diagnostics/fba_inventory_ledger_sellable_vs_unsellable_audit.sql`
checks both:

- `inventario_paises` row for `FR`
- `amazon_fba_inventory_ledger_daily` rows whose `location`, `location_country`,
  SKU, ASIN, or disposition might explain `FR`

## Why GB/DE were -10

The panel values `GB = 385` and `DE = 348` were each 10 units below the visible
SELLABLE ledger values `GB = 395` and `DE = 358`. The most likely source is that
`inventario_paises.stock_fba` was older or populated by a different stock report,
while the visible ledger snapshot contains the latest sellable balances.

## Corrected behavior

For the Inventory country table:

- `FBA vendible` now uses latest Inventory Ledger by physical `location` where
  `disposition = 'SELLABLE'`.
- `FBA no apto` sums latest Inventory Ledger where `disposition <> 'SELLABLE'`.
- `FBA fisico` equals sellable plus unsellable.
- When ledger country rows exist, countries with only legacy
  `inventario_paises.stock_fba` are not shown as real FBA country rows. Legacy
  `inventario_paises` can still add a country only when `stock_fbm > 0`.
- `inventario_paises.stock_fba` is kept only as an audit/reference value in the
  expanded row detail.
- Coverage and risk use sellable FBA, not physical total and not unsellable.
- If the latest ledger country snapshot is older than three days, the UI shows
  a stale-ledger warning instead of silently presenting old values.

If no ledger row exists for a country, the table keeps the legacy
`inventario_paises` fallback so older products still render.

## Recommendation

Use latest Inventory Ledger SELLABLE by physical location as the operational FBA
stock for country-level inventory and coverage. Keep unsellable stock visible
but separate. Do not include `WAREHOUSE_DAMAGED`, `DEFECTIVE`,
`CUSTOMER_DAMAGED`, or other non-SELLABLE dispositions in usable FBA stock.

If `inventario_paises` must remain populated for downstream modules, add a
separate approved recalculation script/RPC later that updates only the selected
product from latest ledger. Do not run that automatically as part of this audit.

## Existing import paths

There are two existing ledger import paths:

- SP-API endpoint: `POST /api/amazon/reports/fba-ledger/import`
  - Implementation: `app/api/amazon/reports/fba-ledger/import/route.ts`
  - Service: `importFbaLedgerDailyFromSpApi`
  - Report type: `GET_LEDGER_SUMMARY_VIEW_DATA`
- Manual CSV endpoint: `POST /api/imports/amazon-fba-ledger-summary`
  - Implementation: `app/api/imports/amazon-fba-ledger-summary/route.ts`
  - Writes only `amazon_fba_inventory_ledger_daily`

Recommended import command for the visible Amazon date:

```bash
curl -X POST http://localhost:3000/api/amazon/reports/fba-ledger/import \
  -H "Content-Type: application/json" \
  --data '{"fromDate":"2026-07-13","toDate":"2026-07-14"}'
```

This requires an authenticated ERP session and configured SP-API environment.
No FBA Sales, `ventas_diarias`, Stockagile, or All Orders import is involved.
