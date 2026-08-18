export async function runWithCanonicalSyncLease<T>(params: {
  gateAction: () => Promise<"skipped_fresh" | "skipped_rate_limit" | "skipped_running" | null>;
  acquireLease: () => Promise<boolean>;
  execute: () => Promise<T>;
}): Promise<
  | { action: "skipped_fresh" | "skipped_rate_limit" | "skipped_running" }
  | { action: "owned"; value: T }
> {
  const gate = await params.gateAction();
  if (gate) return { action: gate };
  if (!(await params.acquireLease())) return { action: "skipped_running" };
  return { action: "owned", value: await params.execute() };
}
