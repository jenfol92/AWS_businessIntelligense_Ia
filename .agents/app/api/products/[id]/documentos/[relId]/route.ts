/**
 * DELETE /api/products/[id]/documentos/[relId]
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { deleteDriveFile } from "@/modules/drive/googleDriveService";
import {
  deleteDocumentoById,
  deleteProductDocumentRelation,
  findProductDocumentsByProductId,
} from "@/modules/products/repositories/productDocumentsRepository";

type Params = { params: { id: string; relId: string } };

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const docs = await findProductDocumentsByProductId(params.id);
  const rel = docs.find(
    (d) => String((d as Record<string, unknown>).id) === params.relId,
  );

  if (!rel) {
    return NextResponse.json({ ok: false, error: "Documento no encontrado" }, { status: 404 });
  }

  const rec = rel as Record<string, unknown>;
  const doc = (rec.documentos ?? null) as Record<string, unknown> | null;
  const driveId = doc ? String(doc.drive_id ?? "") : "";
  const documentoId = String(rec.documento_id ?? doc?.id ?? "");

  if (driveId) {
    try {
      await deleteDriveFile(driveId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error eliminando en Drive";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  await deleteProductDocumentRelation(params.relId);
  if (documentoId) {
    await deleteDocumentoById(documentoId);
  }

  return NextResponse.json({ ok: true });
}
