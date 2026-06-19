/** Cliente HTTP: documentos de producto en Google Drive. */

import type { ProductFormDocumentRow } from "../types";

const DRIVE_NOT_CONFIGURED_MSG = "Google Drive no está configurado.";

/** URL de descarga server-side (requiere sesión). */
export function productDocumentDownloadUrl(
  productId: string,
  driveId: string,
): string {
  return `/api/products/${encodeURIComponent(productId)}/documentos/descargar/${encodeURIComponent(driveId)}`;
}

/** Lista documentos del producto. */
export async function fetchProductDocuments(
  productId: string,
): Promise<ProductFormDocumentRow[]> {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}/documentos`, {
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !Array.isArray(data.rows)) {
    throw new Error(data?.error ?? "No se pudieron cargar los documentos");
  }
  return data.rows as ProductFormDocumentRow[];
}

/** Sube documento a Drive y vincula al producto. */
export async function uploadProductDocumentApi(
  productId: string,
  file: File,
  meta: {
    tipo: string;
    scope?: "shared" | "individual";
    fechaExpiracion?: string | null;
    descripcionExtra?: string | null;
  },
): Promise<void> {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("tipo", meta.tipo);
  if (meta.scope) fd.set("scope", meta.scope);
  if (meta.fechaExpiracion) fd.set("fecha_expiracion", meta.fechaExpiracion);
  if (meta.descripcionExtra) fd.set("descripcion_extra", meta.descripcionExtra);

  const response = await fetch(
    `/api/products/${encodeURIComponent(productId)}/documentos`,
    { method: "POST", body: fd },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    if (data?.drive_required) {
      throw new Error(DRIVE_NOT_CONFIGURED_MSG);
    }
    throw new Error(data?.error ?? "Error al subir documento");
  }
}

/** Elimina relación y archivo en Drive. */
export async function deleteProductDocumentApi(
  productId: string,
  relId: string,
): Promise<void> {
  const response = await fetch(
    `/api/products/${encodeURIComponent(productId)}/documentos/${encodeURIComponent(relId)}`,
    { method: "DELETE" },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "Error al eliminar documento");
  }
}
