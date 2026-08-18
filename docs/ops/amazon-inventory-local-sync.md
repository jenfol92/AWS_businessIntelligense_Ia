# Amazon inventory sync in local development

The local Next.js development server does not run the Vercel cron. The operational trigger before deployment is the Inventory UI, and both that trigger and the future cron delegate to `syncAmazonInventoryCanonical()`.

Use only one `next dev` process when performing an explicitly authorized Amazon sync test. Multiple local processes share the database lease, so only one can own the canonical sync, but avoiding extra servers makes UI state and logs unambiguous. The application must not kill or manage developer processes automatically.

Before a live test:

1. Confirm all local tests, TypeScript, and the production build pass.
2. Confirm no canonical job has a live `RUNNING` lease and no Amazon cooldown is active.
3. Stop extra development servers manually if they are no longer needed.
4. Invoke Inventory refresh once and wait for its observable result.
5. Do not invoke report diagnostics or another refresh concurrently.

A skipped `already_running`/`skipped_running` result is expected concurrency protection, not a failed Amazon request. A rate-limited result preserves the last valid snapshot and starts the existing cooldown.
