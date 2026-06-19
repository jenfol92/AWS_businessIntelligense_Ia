/**
 * Módulo   : orders
 * Archivo  : app/api/orders/[id]/proforma-upload/route.ts
 * Qué hace : POST — sube la proforma firmada (PDF) a Google Drive y actualiza
 *            el campo proforma_firmada_url / proforma_firmada_at en ordenes_compra.
 *
 * Estrategia:
 *   1. Si Drive está configurado, sube a la carpeta del contenedor asociado
 *      (si la orden está en un contenedor) o a _Ordenes_sin_contenedor/NUMERO_ORDEN.
 *   2. Si Drive no está disponible, usa Supabase Storage bucket "order-documents"
 *      como fallback.
 *
 * La respuesta incluye "storage_backend": "drive" | "supabase_storage".
 */

import { NextResponse }              from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { supabaseAdmin }             from "@/server/supabase/adminClient";
import {
  isDriveConfigured,
  uploadProformaFirmada,
}                                    from "@/modules/drive/googleDriveService";

type Params = { params: { id: string } };

const BUCKET = "order-documents";

/**
 * POST /api/orders/[id]/proforma-upload
 *
 * Body: multipart/form-data con campo "file" (PDF obligatorio).
 * Respuesta: { ok: true, url: string, storage_backend: "drive" | "supabase_storage" }
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  // Verificar que la orden existe
  const { data: orden } = await supabase
    .from("ordenes_compra")
    .select("id, estado, numero_orden")
    .eq("id", params.id)
    .single();
  if (!orden) return NextResponse.json({ ok: false, error: "Orden no encontrada" }, { status: 404 });

  // Leer multipart
  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "Formato de datos incorrecto" }, { status: 400 }); }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "No se ha enviado ningún archivo" }, { status: 400 });
  if (file.type !== "application/pdf") return NextResponse.json({ ok: false, error: "Solo se admiten archivos PDF" }, { status: 400 });

  const ts       = Date.now();
  const fileName = `proforma_firmada_${ts}.pdf`;
  const buffer   = Buffer.from(await file.arrayBuffer());
  const numeroOrden = String((orden as Record<string, unknown>)["numero_orden"] ?? params.id);

  // ── Buscar contenedor asociado ────────────────────────────────────────────
  let identificadorEmbarque: string | null = null;
  if (isDriveConfigured()) {
    const { data: link } = await supabase
      .from("contenedor_ordenes")
      .select("contenedor_id, contenedores(identificador_embarque)")
      .eq("orden_id", params.id)
      .limit(1)
      .single();
    if (link) {
      const cont = (link as Record<string, unknown>)["contenedores"] as Record<string, unknown> | null;
      identificadorEmbarque = cont ? String(cont["identificador_embarque"] ?? "") || null : null;
    }
  }

  // ── Intento 1: Drive ───────────────────────────────────────────────────────
  let publicUrl      = "";
  let storageBackend: "drive" | "supabase_storage" = "supabase_storage";

  if (isDriveConfigured()) {
    try {
      const result = await uploadProformaFirmada(
        numeroOrden,
        fileName,
        buffer,
        identificadorEmbarque,
      );
      publicUrl      = result.web_view_link;
      storageBackend = "drive";
    } catch (driveErr: unknown) {
      console.error("[proforma-upload] Drive failed, fallback a Storage:", driveErr instanceof Error ? driveErr.message : driveErr);
    }
  }

  // ── Fallback: Supabase Storage ────────────────────────────────────────────
  if (storageBackend === "supabase_storage") {
    const filePath = `proformas/${numeroOrden}/${fileName}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      return NextResponse.json({ ok: false, error: `Error al subir: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filePath);
    publicUrl = urlData?.publicUrl ?? "";
  }

  // ── Actualizar ordenes_compra ─────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("ordenes_compra")
    .update({
      proforma_firmada_url: publicUrl,
      proforma_firmada_at:  new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: `Error al guardar URL: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: publicUrl, storage_backend: storageBackend });
}
