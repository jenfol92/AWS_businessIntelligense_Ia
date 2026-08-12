# FBA inventory canonical source

## Decision

The official source for Amazon FBA inventory in ERP_BI_IA is:

`amazon_fba_inventory_ledger_daily`

The official UI/read-model view is:

`v_latest_fba_inventory_by_product_country`

`inventario_paises.stock_fba` is no longer the operational source for FBA
stock. It remains useful only for legacy audit, old auxiliary country data, and
FBM fields (`stock_fbm`).

## Canonical view

The view `v_latest_fba_inventory_by_product_country` returns one row per
`producto_id + pais`, using the latest `snapshot_date` available per product.

Country is derived from physical ledger location:

```sql
COALESCE(NULLIF(trim(location), ''), NULLIF(trim(location_country), ''), 'UNKNOWN')
```

FBA stock fields:

- `stock_fba_sellable`: `SUM(ending_warehouse_balance)` where
  `upper(trim(disposition)) = 'SELLABLE'`
- `stock_fba_unsellable`: `SUM(ending_warehouse_balance)` where disposition is
  not `SELLABLE`
- `stock_fba_physical_total`: sellable plus unsellable

The UI uses sellable FBA for operational stock, coverage, and risk. Unsellable
stock is visible but separate.

## Inventory UI

The Inventory country table now reads FBA country stock from
`v_latest_fba_inventory_by_product_country` through
`fetchLatestFbaInventoryByProductCountry`.

`inventario_paises` contributes only:

- `stock_fbm`
- legacy/audit value `stock_fba` in the expanded row detail

If the canonical FBA view has no country row, FBA for that country is zero. The
UI does not silently fall back to `inventario_paises.stock_fba`.

The table always shows the latest FBA snapshot/import date and warns when the
Inventory Ledger is stale.

## Stock vs sales

Inventory stock and sales are separate flows:

- Stock cron/report: `GET_LEDGER_SUMMARY_VIEW_DATA`
  - feeds `amazon_fba_inventory_ledger_daily`
  - feeds `v_latest_fba_inventory_by_product_country`
- Sales/shipment cron/report: `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL`
  - feeds `amazon_fba_sales_daily_raw`
  - feeds `ventas_diarias`

Sales reports must not be used as the source of FBA stock. Inventory Ledger must
not be confused with customer shipment sales.

## Operational recommendation

Keep the Inventory Ledger import fresh. For a specific date range, use the
existing endpoint:

```bash
curl -X POST http://localhost:3000/api/amazon/reports/fba-ledger/import \
  -H "Content-Type: application/json" \
  --data '{"fromDate":"2026-07-13","toDate":"2026-07-14"}'
```

This endpoint requests `GET_LEDGER_SUMMARY_VIEW_DATA` and writes the ledger
table. It does not touch FBA Sales, `ventas_diarias`, Stockagile, or All Orders.
