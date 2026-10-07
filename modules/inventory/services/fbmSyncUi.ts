import type { FbmResult } from "@/modules/amazon-sp-api/fbmSyncCoordinator";

export function fbmSyncMessage(job: FbmResult | null): string | null {
  if (!job) return null;
  if (job.status === "COMPLETED") return `Stock FBM publicado: ${job.rowsCommitted} productos.`;
  if (job.status === "RATE_LIMITED") return "Amazon ha limitado las consultas. El servidor reintentará cuando corresponda.";
  if (job.status === "PENDING") return "Informe solicitado; pendiente de continuación por el servidor.";
  if (job.status === "PROCESSING") return job.phase === "PUBLISH" ? "Informe listo; publicación pendiente por el servidor." : "Amazon está procesando el informe.";
  if (job.status === "CREATE_UNCERTAIN") return "No se pudo confirmar la creación del informe. Requiere revisión antes de iniciar otro.";
  if (job.error === "FBM_IDENTITY_UNIVERSE_CHANGED") return "El catálogo cambió de forma no reconciliable. Se conserva el stock anterior; revisa el cambio antes de iniciar otra sincronización.";
  if (job.error === "REPORT_COVERAGE_ERROR") return "El informe no cubre todos los productos activos. Se conserva el stock anterior.";
  return "La sincronización FBM no se completó. Se conserva el stock anterior; puedes iniciar una nueva sincronización tras revisar el error.";
}
