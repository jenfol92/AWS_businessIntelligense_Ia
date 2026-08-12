# Inventory demand: delivery country vs sales marketplace

## Context

The Inventory detail table "Stock por pais" previously showed `V.30d` and
`V.90d`. Those labels were ambiguous: the underlying values came from
`ventas_diarias.pais`, which in the current FBA sales flow represents the
customer delivery country derived from `ship_to_country` in
`GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL`.

That means `GB V.30d = 46` means 46 units delivered to GB, not necessarily 46
units sold on the UK marketplace.

## Why it was confusing

Seller Central and marketplace reports are usually reconciled by marketplace of
sale, for example `amazon.co.uk`, `amazon.de`, or `amazon.es`. The ERP country
stock table was showing delivery geography, so cross-border deliveries created
expected differences:

- `amazon.de` shipped to AT counts as delivery AT, but marketplace DE.
- `amazon.es` shipped to PT counts as delivery PT, but marketplace ES.
- `amazon.co.uk` shipped to IE counts as delivery IE, but marketplace GB.

## New columns

The existing columns were renamed:

- `Entrega 30d`
- `Entrega 90d`

These still use the existing `ventas_diarias.pais` logic and are useful for
geographic demand and logistics analysis.

New columns were added:

- `Ventas marketplace 30d`
- `Ventas marketplace 90d`

These use `amazon_fba_sales_daily_raw.raw->>'sales-channel'` from
`GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` and map sales channels to
marketplace country codes. The calculation intentionally does not depend on the
current `marketplace_id` value because historical rows may all carry
`A1RKKUPIHCS9HS`.

## Which metric to use

Use marketplace demand (`Ventas marketplace 30d` /
`Ventas marketplace 90d`) when comparing with Seller Central, planning Amazon
ES/FR/DE/IT/UK marketplace sales, or reconciling sales channels.

Use delivery demand (`Entrega 30d` / `Entrega 90d`) when analyzing where the
product physically ends up, geographic customer demand, and delivery-country
distribution.

## Forecast and purchasing recommendation

For purchasing and inventory planning, marketplace demand should be the primary
comparison against Seller Central and competitor planning by Amazon marketplace.
Delivery demand should remain visible as supporting context for geography and
cross-border behavior.

Future importer/RPC work should derive `marketplace_id` from `sales-channel`
instead of reusing a single default marketplace id across countries.
