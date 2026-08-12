export type AmazonReportSupersededJob = {
  report_type: string;
  requested_at: string | null;
  updated_at: string | null;
};

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function isAmazonReportJobSupersededByImportedJob(
  job: AmazonReportSupersededJob,
  imported: AmazonReportSupersededJob | null,
): boolean {
  if (!imported) return false;
  if (job.report_type !== imported.report_type) return false;

  const jobTime = timestampMs(job.requested_at) || timestampMs(job.updated_at);
  const importedTime =
    timestampMs(imported.requested_at) || timestampMs(imported.updated_at);
  return importedTime > jobTime;
}
