# Inventory price top: marketplace vs delivery

## Decision

`Precio top 30d` and `Precio top 90d` in Inventory must follow the same country basis as `Ventas marketplace 30d` and `Ventas marketplace 90d`: the Amazon marketplace derived from `raw->>'sales-channel'`.

They must not use `ship_to_country` as the primary filter.

## Previous behavior

The FBA price distribution used `amazon_fba_sales_daily_raw.ship_to_country` to filter rows by country.

That calculated the top unit price by customer delivery country. For example, DE meant shipments delivered to Germany, not necessarily sales made through amazon.de.

## Current behavior

The FBA price distribution reads `amazon_fba_sales_daily_raw` for the product/date window, validates:

`raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'`

Then it derives the marketplace country from:

`raw->>'sales-channel'`

Only rows whose marketplace country matches the Inventory country row are included in the top-price grouping.

## Why

Inventory already separates:

- `Entrega 30d` / `Entrega 90d`: customer delivery country from `ship_to_country`.
- `Ventas marketplace 30d` / `Ventas marketplace 90d`: marketplace country from `sales-channel`.

The price top columns are used next to marketplace sales columns, so they must use the same marketplace basis.

## Non-goals

This change does not alter stock FBA, Inventory Ledger, cron, importers, `ventas_diarias`, Stockagile, All Orders, or deep forecast logic.
