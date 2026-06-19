/**
 * GET/POST /api/products/[id]/documentos
 * Documentación de producto en Google Drive + tablas documentos / producto_documentos_rel.
 * Separado de documentos de contenedor.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  deleteDriveFile,
  isDriveConfigured,
  uploadProductDocument,
} from "@/modules/drive/googleDriveService";
import {
  deleteProductDocumentRelation,
  findDocumentoByDriveId,
  findProductDocumentsByProductId,
  insertDocumento,
  insertProductDocumentRelation,
} from "@/modules/products/repositories/productDocumentsRepository";

type Params = { params: { id: string } };

export type ProductDocumentoRow = {
  relId: string;
  documentoId: string;
  tipo: string | null;
  nombreArchivo: string | null;
  driveId: string;
  fechaExpiracion: string | null;
  descripcionExtra: string | null;
  estaVerificado: boolean;
  createdAt: string | null;
};

function mapRows(raw: unknown[]): ProductDocumentoRow[] {
  return raw.map((item) => {
    const r = item as Record<string, unknown>;
    const d = (r.documentos ?? null) as Record<string, unknown> | null;
    return {
      relId: String(r.id ?? ""),
      documentoId: String(r.documento_id ?? d?.id ?? ""),
      tipo: r.tipo ? String(r.tipo) : null,
      nombreArchivo: d ? String(d.nombre_archivo ?? "") || null : null,
      driveId: d ? String(d.drive_id ?? "") : "",
      fechaExpiracion:
        String(r.fecha_expiracion ?? d?.fecha_expiracion ?? "") || null,
      descripcionExtra: r.descripcion_extra
        ? String(r.descripcion_extra)
        : null,
      estaVerificado: r.esta_verificado === true,
      createdAt: String(d?.created_at ?? r.created_at ?? "") || null,
    };
  });
}

/** GET — lista documentos del producto. */
export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const rows = await findProductDocumentsByProductId(params.id);
  return NextResponse.json({ ok: true, rows: mapRows(rows) });
}

/** POST — sube documento a Drive y vincula al producto. */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Google Drive no está configurado.",
        drive_required: true,
      },
      { status: 503 },
    );
  }

  const { data: producto } = await supabase
    .from("productos")
    .select("id, sku, nombre, parent_id")
    .eq("id", params.id)
    .single();

  if (!producto) {
    return NextResponse.json({ ok: false, error: "Producto no encontrado" }, { status: 404 });
  }

  let parentSku: string | null = null;
  let parentNombre: string | null = null;
  const parentId = String((producto as Record<string, unknown>).parent_id ?? "");
  if (parentId) {
    const { data: parent } = await supabase
      .from("productos")
      .select("sku, nombre")
      .eq("id", parentId)
      .maybeSingle();
    if (parent) {
      parentSku = String((parent as Record<string, unknown>).sku ?? "");
      parentNombre = String((parent as Record<string, unknown>).nombre ?? "");
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "FormData inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ ok: false, error: "Falta archivo" }, { status: 400 });
  }

  if (file.size > 30 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Máximo 30 MB" }, { status: 400 });
  }

  const tipo = String(formData.get("tipo") ?? "otros");
  const scopeRaw = String(formData.get("scope") ?? "shared");
  const scope = scopeRaw === "individual" ? "individual" : "shared";
  const descripcionExtra = String(formData.get("descripcion_extra") ?? "").trim() || null;
  const fechaExpiracion = String(formData.get("fecha_expiracion") ?? "").trim() || null;

  const sku = String((producto as Record<string, unknown>).sku ?? "");
  const nombre = String((producto as Record<string, unknown>).nombre ?? "");

  const buffer = Buffer.from(await file.arrayBuffer());

  let driveResult;
  try {
    driveResult = await uploadProductDocument(
      { sku, nombre, parentSku, parentNombre, scope },
      file.name,
      buffer,
      file.type || "application/octet-stream",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error subiendo a Drive";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const docRow = await insertDocumento({
    nombre_archivo: file.name,
    drive_id: driveResult.drive_id,
    fecha_expiracion: fechaExpiracion,
  });

  const docId = String((docRow as Record<string, unknown>).id ?? "");

  const rel = await insertProductDocumentRelation({
    producto_id: params.id,
    documento_id: docId,
    tipo,
    descripcion_extra: descripcionExtra,
    esta_verificado: false,
    fecha_expiracion: fechaExpiracion,
  });

  const row: ProductDocumentoRow = {
    relId: String((rel as Record<string, unknown>).id ?? ""),
    documentoId: docId,
    tipo,
    nombreArchivo: file.name,
    driveId: driveResult.drive_id,
    fechaExpiracion,
    descripcionExtra,
    estaVerificado: false,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json({
    ok: true,
    row,
    storage_backend: "drive",
    drive_view_link: driveResult.web_view_link,
  });
}

/** DELETE handler lives in [relId]/route.ts */
