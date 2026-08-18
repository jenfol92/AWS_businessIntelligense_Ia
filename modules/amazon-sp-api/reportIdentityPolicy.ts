const LOCAL_JOB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertAmazonReportId(reportId: string): void {
  if (!reportId.trim()) throw new Error("Amazon reportId vacio.");
  if (LOCAL_JOB_UUID.test(reportId.trim())) {
    throw new Error("Se recibio un local job UUID donde se esperaba Amazon reportId.");
  }
}
