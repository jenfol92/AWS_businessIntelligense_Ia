# Amazon forecast/logistics pipeline

## Sources and mapping

| ERP read model | Amazon source | Mapping/grain |
| --- | --- | --- |
| Operational FBA | `GET /fba/inventory/v1/summaries` | confirmed FBA Seller SKU → `producto_id`/`sku_limpio`; raw row remains `Seller SKU + ASIN + FNSKU + marketplace`; available is `inventoryDetails.fulfillableQuantity` only |
| Physical FBA country | `GET_AFN_INVENTORY_DATA_BY_COUNTRY` | `seller-sku` → `sku_limpio`/`producto_id`; `quantity-for-local-fulfillment`; aggregate only within product + country; `raw.sources` preserves contributors |
| Physical reconciliation | `GET_LEDGER_SUMMARY_VIEW_DATA`, `aggregateByLocation=COUNTRY` | audit/reconciliation only; never substitutes BY_COUNTRY |
| Daily sales | `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` → `amazon_fba_sales_daily_raw` → `v_amazon_fba_sales_daily` → `sync_ventas_diarias_from_amazon_fba_sales` → `ventas_diarias` | date, product, country, channel, units, amount, currency; source-scoped atomic sync and duplicate/conflict checks |

## Pool strategy

Default is six independent continental marketplaces plus GB. The 135-SKU catalog therefore plans 3 batches × 7 marketplaces = 21 Inventory Summary requests. The `PAN_EU + GB` reduction (6 requests) is unavailable until an explicit ES-vs-DE evidence row is `APPROVED`; no migration inserts such evidence.

## Read model

`v_amazon_forecast_logistics_read_model` keeps operational marketplace stock separate from physical country stock and exposes 7d/30d sales, configured lead time, configured safety days, coverage, lead-time demand and projected shortage. It reuses `producto_supply_config`, `v_forecast_inbound_items`, and confirmed shipment destination country; missing configuration remains zero/NULL rather than inventing defaults.

## First full-sync plan (not executed)

1. Confirm the 135-SKU FBA identity set and exclude FBM/ambiguous identities.
2. Run a controlled ES-vs-DE equivalence test for the exact SKU set; persist evidence only through the approved evidence workflow.
3. Select either 21 requests (independent marketplaces) or 6 requests (approved `PAN_EU + GB`).
4. For every marketplace, fetch all 3 SKU batches with page-level fail-closed handling and rate-limit pacing.
5. Publish one complete operational snapshot run atomically; never publish a partial run.
6. Run BY_COUNTRY separately and publish the daily physical-country snapshot with Seller SKU provenance.
7. Run the existing fulfilled-shipments sales pipeline, then refresh the read model.
8. Validate duplicate grains, timezone/date boundaries, cancellations/returns, unresolved SKUs and source freshness before enabling recommendations.

No Amazon full sync, Supabase write, snapshot write or migration execution was performed in this implementation phase.
