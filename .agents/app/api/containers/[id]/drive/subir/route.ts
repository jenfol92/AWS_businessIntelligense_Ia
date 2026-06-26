/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/drive/subir/route.ts
 * Qué hace : POST — Alias de POST /api/containers/[id]/documentos para compatibilidad
 *            con el legacy que usaba la ruta /drive/subir.
 *            La lógica real está en el endpoint de documentos.
 *
 * Google Drive no está migrado al proyecto nuevo.
 * Los archivos se suben a Supabase Storage (bucket "container-documents").
 */

import { NextResponse } from "next/server";

type Params = { params: { id: string } };

/**
 * POST /api/containers/[id]/drive/subir
 *
 * Redirige internamente a POST /api/containers/[id]/documentos.
 * Acepta el mismo multipart: file + tipo_documento.
 */
export async function POST(req: Request, { params }: Params) {
  // Reenviar la petición al endpoint canónico de documentos
  const url      = new URL(req.url);
  const newUrl   = url.origin + `/api/containers/${params.id}/documentos`;
  const response = await fetch(newUrl, {
    method:  "POST",
    body:    req.body,
    headers: Object.fromEntries(req.headers.entries()),
    // @ts-expect-error duplex es necesario en Node.js 18+ para streams
    duplex:  "half",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
