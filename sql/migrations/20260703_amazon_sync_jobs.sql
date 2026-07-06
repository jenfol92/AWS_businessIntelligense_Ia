create table if not exists public.amazon_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text unique not null,
  last_run_at timestamptz null,
  last_success_at timestamptz null,
  last_status text null,
  last_error text null,
  last_rows_upserted integer null,
  next_run_hint text null,
  updated_at timestamptz not null default now()
);

