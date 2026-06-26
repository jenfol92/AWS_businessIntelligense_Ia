/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/documentos/route.ts
 * Qué hace : GET  — Devuelve los documentos vinculados al contenedor.
 *            POST — Sube un archivo a Google Drive (carpeta del contenedor)
 *                   e inserta los registros en documentos + contenedor_documentos_rel.
 *
 * Esquema real de Supabase:
 *   documentos:
 *     id uuid, nombre_archivo text, drive_id text NOT NULL,
 *     fecha_expiracion date, created_at timestamptz
 *   contenedor_documentos_rel:
 *     id uuid, contenedor_id uuid, documento_id uuid,
 *     tipo_documento text, subido_por uuid, created_at timestamptz
 *
 * Restricción clave: drive_id es NOT NULL → solo se puede insertar en documentos
 * cuando se dispone de un drive_id real obtenido de Google Drive.
 * Si Drive no está configurado o falla, el endpoint devuelve un error explicativo.
 * No existe fallback a Supabase Storage para esta tabla.
 */

import { NextResponse }              from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  isDriveConfigured,
  uploadContainerDocument,
}                                    from "@/modules/drive/googleDriveService";

type Params = { params: { id: string } };

/** Fila de documento devuelta al cliente (columnas reales de la tabla documentos). */
export type DocumentoRow = {
  /** ID del vínculo en contenedor_documentos_rel. */
  id:               string;
  /** ID del registro en documentos. */
  documento_id:     string;
  nombre_archivo:   string | null;
  /** ID del archivo en Google Drive. Siempre presente si el doc fue subido. */
  drive_id:         string;
  /** Tipo de documento (columna en contenedor_documentos_rel). */
  tipo_documento:   string | null;
  fecha_expiracion: string | null;
  created_at:       string | null;
};

// ─── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/containers/[id]/documentos
 * Respuesta: { ok: true, rows: DocumentoRow[] }
 */
export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  // Intento 1: join embebido PostgREST
  // tipo_documento está en la tabla rel, no en documentos
  const joined = await supabase
    .from("contenedor_documentos_rel")
    .select(
      "id, documento_id, tipo_documento, created_at, " +
      "documentos(id, nombre_archivo, drive_id, fecha_expiracion, created_at)",
    )
    .eq("contenedor_id", params.id)
    .order("created_at", { ascending: false });

  if (!joined.error && Array.isArray(joined.data)) {
    const rows: DocumentoRow[] = (joined.data as unknown as Array<Record<string, unknown>>).map((r) => {
      const d = (r["documentos"] ?? null) as Record<string, unknown> | null;
      return {
        id:               String(r["id"]             ?? ""),
        documento_id:     String(r["documento_id"]   ?? ""),
        tipo_documento:   r["tipo_documento"] ? String(r["tipo_documento"]) : null,
        nombre_archivo:   d ? String(d["nombre_archivo"] ?? "") || null : null,
        drive_id:         d ? String(d["drive_id"]         ?? "") : "",
        fecha_expiracion: d ? String(d["fecha_expiracion"] ?? "") || null : null,
        created_at:       String(r["created_at"] ?? d?.["created_at"] ?? "") || null,
      };
    });
    return NextResponse.json({ ok: true, rows });
  }

  // Intento 2: dos consultas separadas (fallback si el join no está habilitado en PostgREST)
  const rel = await supabase
    .from("contenedor_documentos_rel")
    .select("id, documento_id, tipo_documento, created_at")
    .eq("contenedor_id", params.id)
    .order("created_at", { ascending: false });

  if (rel.error) return NextResponse.json({ ok: true, rows: [] });

  const docIds = (rel.data ?? [])
    .map((r: Record<string, unknown>) => r["documento_id"])
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  if (docIds.length === 0) return NextResponse.json({ ok: true, rows: [] });

  const docs = await supabase
    .from("documentos")
    .select("id, nombre_archivo, drive_id, fecha_expiracion, created_at")
    .in("id", docIds);

  const byId = new Map((docs.data ?? []).map((d: Record<string, unknown>) => [String(d["id"]), d]));

  const rows: DocumentoRow[] = (rel.data ?? []).map((r: Record<string, unknown>) => {
    const d = byId.get(String(r["documento_id"]));
    return {
      id:               String(r["id"]           ?? ""),
      documento_id:     String(r["documento_id"] ?? ""),
      tipo_documento:   r["tipo_documento"] ? String(r["tipo_documento"]) : null,
      nombre_archivo:   d ? String(d["nombre_archivo"] ?? "") || null : null,
      drive_id:         d ? String(d["drive_id"]         ?? "") : "",
      fecha_expiracion: d ? String(d["fecha_expiracion"] ?? "") || null : null,
      created_at:       String(r["created_at"] ?? d?.["created_at"] ?? "") || null,
    };
  });

  return NextResponse.json({ ok: true, rows });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/containers/[id]/documentos
 *
 * Body: multipart/form-data
 *   file           — archivo obligatorio
 *   tipo_documento — string opcional ("BL", "Factura", "Packing List", etc.)
 *
 * Flujo:
 *   1. Sube el archivo a Google Drive (carpeta del contenedor).
 *   2. Inserta registro en documentos con el drive_id obtenido.
 *   3. Inserta vínculo en contenedor_documentos_rel con tipo_documento.
 *
 * IMPORTANTE: drive_id es NOT NULL. Si Drive no está configurado o falla,
 *   el endpoint devuelve HTTP 503 con un mensaje claro. No existe fallback.
 *
 * Respuesta: { ok: true, row: DocumentoRow }
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  // Verificar Drive antes de todo
  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        ok:    false,
        error: "Google Drive no está configurado todavía para guardar documentos de contenedor. " +
               "Configura GOOGLE_DRIVE_FOLDER_ID, GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN, " +
               "GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local.",
        drive_required: true,
      },
      { status: 503 },
    );
  }

  // Verificar contenedor
  const { data: cont } = await supabase
    .from("contenedores")
    .select("id, identificador_embarque")
    .eq("id", params.id)
    .single();
  if (!cont) return NextResponse.json({ ok: false, error: "Contenedor no encontrado" }, { status: 404 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: "Formato de datos incorrecto" }, { status: 400 }); }

  const file          = formData.get("file") as File | null;
  const tipoDocumento = (formData.get("tipo_documento") as string | null) ?? null;

  if (!file) return NextResponse.json({ ok: false, error: "No se ha enviado ningún archivo" }, { status: 400 });

  const idEmb  = String((cont as Record<string, unknown>)["identificador_embarque"] ?? params.id);
  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Subida a Google Drive ─────────────────────────────────────────────────
  let driveId: string;
  let driveViewLink: string;

  try {
    const result = await uploadContainerDocument(
      idEmb,
      file.name,
      buffer,
      file.type || "application/octet-stream",
    );
    driveId       = result.drive_id;
    driveViewLink = result.web_view_link;
  } catch (driveErr: unknown) {
    const msg = driveErr instanceof Error ? driveErr.message : "Error desconocido";
    return NextResponse.json(
      { ok: false, error: `Error al subir a Google Drive: ${msg}` },
      { status: 500 },
    );
  }

  // ── Insertar en tabla documentos ─────────────────────────────────────────
  const { data: docRow, error: docErr } = await supabase
    .from("documentos")
    .insert({
      nombre_archivo: file.name,
      drive_id:       driveId,
      created_at:     new Date().toISOString(),
    })
    .select("id")
    .single();

  if (docErr || !docRow) {
    return NextResponse.json(
      { ok: false, error: `Error al registrar documento: ${docErr?.message ?? "desconocido"}` },
      { status: 500 },
    );
  }

  const docId = String((docRow as Record<string, unknown>)["id"] ?? "");

  // ── Insertar vínculo en contenedor_documentos_rel ────────────────────────
  const { error: relErr } = await supabase
    .from("contenedor_documentos_rel")
    .insert({
      contenedor_id:  params.id,
      documento_id:   docId,
      tipo_documento: tipoDocumento,
      subido_por:     user.id,
      created_at:     new Date().toISOString(),
    });

  if (relErr) {
    return NextResponse.json(
      { ok: false, error: `Error al vincular documento: ${relErr.message}` },
      { status: 500 },
    );
  }

  const row: DocumentoRow = {
    id:               "",
    documento_id:     docId,
    nombre_archivo:   file.name,
    drive_id:         driveId,
    tipo_documento:   tipoDocumento,
    fecha_expiracion: null,
    created_at:       new Date().toISOString(),
  };

  return NextResponse.json({
    ok:              true,
    row,
    storage_backend: "drive",
    drive_view_link: driveViewLink,
  });
}
