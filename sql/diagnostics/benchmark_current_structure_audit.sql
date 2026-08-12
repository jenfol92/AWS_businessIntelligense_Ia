-- Benchmark / Helium 10 current structure audit.
-- SELECT-only diagnostic. It does not import, update, delete, or backfill data.

-- 1) Relevant table existence.
select
  'table_exists' as section,
  t.table_schema,
  t.table_name
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_name in (
    'competitor_benchmark_snapshots',
    'product_competitor_benchmark_selection',
    'benchmarking_results'
  )
order by t.table_name;

-- 2) Column shape expected by the current benchmark readers.
select
  'columns' as section,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'competitor_benchmark_snapshots',
    'product_competitor_benchmark_selection',
    'benchmarking_results'
  )
order by c.table_name, c.ordinal_position;

-- 3) Constraints for benchmark tables.
select
  'constraints' as section,
  conrelid::regclass::text as table_name,
  conname,
  contype,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.competitor_benchmark_snapshots'::regclass,
  'public.product_competitor_benchmark_selection'::regclass,
  'public.benchmarking_results'::regclass
)
order by table_name, conname;

-- 4) Indexes for benchmark tables.
select
  'indexes' as section,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'competitor_benchmark_snapshots',
    'product_competitor_benchmark_selection',
    'benchmarking_results'
  )
order by tablename, indexname;

-- 5) Snapshot volume by source and marketplace.
select
  'snapshot_volume_by_source_marketplace' as section,
  coalesce(source, 'NULL') as source,
  coalesce(marketplace_country, 'NULL') as marketplace_country,
  count(*) as rows_total,
  count(distinct producto_id) filter (where producto_id is not null) as products_by_id,
  count(distinct candidate_sku) filter (where candidate_sku is not null) as products_by_sku,
  count(distinct competitor_asin) filter (where competitor_asin is not null) as competitors,
  min(snapshot_date) as min_snapshot_date,
  max(snapshot_date) as max_snapshot_date,
  count(*) filter (where estimated_monthly_units is not null and estimated_monthly_units > 0) as rows_with_units,
  count(*) filter (where price is not null) as rows_with_price,
  count(*) filter (where estimated_monthly_revenue is not null) as rows_with_revenue
from public.competitor_benchmark_snapshots
group by coalesce(source, 'NULL'), coalesce(marketplace_country, 'NULL')
order by rows_total desc;

-- 6) Rows currently usable by Forecast/Inventory benchmark logic.
select
  'forecast_usable_snapshot_rows' as section,
  coalesce(marketplace_country, 'NULL') as marketplace_country,
  count(*) as rows_total,
  count(*) filter (where estimated_monthly_units is not null and estimated_monthly_units > 0) as usable_rows,
  count(*) filter (
    where estimated_monthly_units is not null
      and estimated_monthly_units > 0
      and producto_id is not null
  ) as usable_by_producto_id,
  count(*) filter (
    where estimated_monthly_units is not null
      and estimated_monthly_units > 0
      and producto_id is null
      and nullif(trim(candidate_sku), '') is not null
  ) as usable_by_candidate_sku_only,
  count(*) filter (
    where estimated_monthly_units is not null
      and estimated_monthly_units > 0
      and nullif(trim(competitor_asin), '') is not null
  ) as usable_with_asin
from public.competitor_benchmark_snapshots
group by coalesce(marketplace_country, 'NULL')
order by usable_rows desc;

-- 7) Rows that look incomplete for the current benchmark consumers.
select
  'snapshot_quality_flags' as section,
  count(*) as rows_total,
  count(*) filter (where producto_id is null and nullif(trim(candidate_sku), '') is null) as missing_product_and_sku,
  count(*) filter (where nullif(trim(competitor_asin), '') is null) as missing_competitor_asin,
  count(*) filter (where estimated_monthly_units is null or estimated_monthly_units <= 0) as missing_or_non_positive_units,
  count(*) filter (where marketplace_country is null or trim(marketplace_country) = '') as missing_marketplace_country,
  count(*) filter (where snapshot_date is null) as missing_snapshot_date
from public.competitor_benchmark_snapshots;

-- 8) Possible duplicate snapshot keys.
select
  'possible_duplicate_snapshot_keys' as section,
  producto_id,
  candidate_sku,
  marketplace_country,
  competitor_asin,
  snapshot_date,
  source,
  count(*) as rows
from public.competitor_benchmark_snapshots
group by
  producto_id,
  candidate_sku,
  marketplace_country,
  competitor_asin,
  snapshot_date,
  source
having count(*) > 1
order by rows desc, snapshot_date desc nulls last
limit 100;

-- 9) Manual competitor selection state.
select
  'selection_summary' as section,
  marketplace_country,
  count(*) as rows_total,
  count(*) filter (where is_selected) as selected_rows,
  count(*) filter (where use_for_forecast) as forecast_rows,
  count(*) filter (where weight is not null) as rows_with_weight,
  count(*) filter (where capture_pct is not null) as rows_with_capture_pct,
  count(distinct producto_id) as products
from public.product_competitor_benchmark_selection
group by marketplace_country
order by rows_total desc;

-- 10) Snapshot rows joined to manual selection flags.
select
  'snapshots_with_selection_flags' as section,
  s.producto_id,
  s.marketplace_country,
  s.competitor_asin,
  max(s.snapshot_date) as latest_snapshot_date,
  max(s.estimated_monthly_units) as max_estimated_monthly_units,
  bool_or(coalesce(sel.is_selected, false)) as selected,
  bool_or(coalesce(sel.use_for_forecast, false)) as use_for_forecast
from public.competitor_benchmark_snapshots s
left join public.product_competitor_benchmark_selection sel
  on sel.producto_id = s.producto_id
 and sel.marketplace_country = s.marketplace_country
 and sel.competitor_asin = s.competitor_asin
where s.producto_id is not null
group by s.producto_id, s.marketplace_country, s.competitor_asin
order by latest_snapshot_date desc nulls last
limit 200;

-- 11) Legacy Amazon benchmarking table volume. This is not the current Forecast input.
select
  'legacy_benchmarking_results_volume' as section,
  count(*) as rows_total,
  count(distinct producto_id) as products,
  min(created_at) as min_created_at,
  max(created_at) as max_created_at
from public.benchmarking_results;
