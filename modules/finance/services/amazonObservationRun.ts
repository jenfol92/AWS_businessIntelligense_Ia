/** One published run, or the explicitly bounded pre-run legacy snapshot. Never both. */
export type AmazonObservationSelection = { runId: string | null; observedAt: string | null };
export function readPublishedAmazonObservation(lastResult: unknown): AmazonObservationSelection {
  const observations = (lastResult as { observations?: Record<string, unknown> } | null)?.observations;
  const runId = observations?.runId;
  if (runId != null && (typeof runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId))) {
    throw new Error("INVALID_PUBLISHED_AMAZON_RUN");
  }
  return { runId: typeof runId === "string" ? runId : null,
    observedAt: typeof observations?.observedAt === "string" ? observations.observedAt : null };
}
export function amazonObservationFilter(selection: AmazonObservationSelection) {
  if (selection.runId) return { column: "sync_run_id", value: selection.runId };
  if (selection.observedAt) return { column: "snapshot_at", value: selection.observedAt };
  return null;
}
