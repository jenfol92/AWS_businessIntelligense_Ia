// modules/products/repositories/productDocumentsRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: producto_documentos_rel + documentos.
// Devuelve documentos relacionados con un producto.
export async function findProductDocumentsByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_documentos_rel")
    .select(`
      id,
      producto_id,
      documento_id,
      tipo,
      descripcion_extra,
      es_obligatorio_bi,
      esta_verificado,
      mercado,
      fecha_expiracion,
      documentos (
        id,
        nombre_archivo,
        drive_id,
        fecha_expiracion,
        created_at
      )
    `)
    .eq("producto_id", productId);

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Vincula un documento existente a un producto.
export async function insertProductDocumentRelation(payload: {
  producto_id: string;
  documento_id: string;
  tipo?: string;
  descripcion_extra?: string | null;
  es_obligatorio_bi?: boolean;
  esta_verificado?: boolean;
  mercado?: string | null;
  fecha_expiracion?: string | null;
}) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_documentos_rel")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

// Elimina una relación producto-documento.
export async function deleteProductDocumentRelation(relationId: string) {
  const supabase = createSupabaseRouteClient();

  const { error } = await supabase
    .from("producto_documentos_rel")
    .delete()
    .eq("id", relationId);

  if (error) throw new Error(error.message);

  return true;
}

/** Inserta fila en `documentos`. */
export async function insertDocumento(payload: {
  nombre_archivo: string;
  drive_id: string;
  fecha_expiracion?: string | null;
}) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("documentos")
    .insert({
      nombre_archivo: payload.nombre_archivo,
      drive_id: payload.drive_id,
      fecha_expiracion: payload.fecha_expiracion ?? null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Elimina documento por ID (y su relación debería borrarse en cascada o antes). */
export async function deleteDocumentoById(documentoId: string) {
  const supabase = createSupabaseRouteClient();
  const { error } = await supabase
    .from("documentos")
    .delete()
    .eq("id", documentoId);
  if (error) throw new Error(error.message);
  return true;
}

/** Busca documento por drive_id. */
export async function findDocumentoByDriveId(driveId: string) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("documentos")
    .select("id, drive_id, nombre_archivo")
    .eq("drive_id", driveId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Comprueba que un drive_id pertenece a un producto vía producto_documentos_rel. */
export async function productOwnsDriveDocument(
  productId: string,
  driveId: string,
): Promise<boolean> {
  const rows = await findProductDocumentsByProductId(productId);
  return rows.some((row) => {
    const rec = row as Record<string, unknown>;
    const doc = (rec.documentos ?? null) as Record<string, unknown> | null;
    return doc && String(doc.drive_id ?? "") === driveId;
  });
}