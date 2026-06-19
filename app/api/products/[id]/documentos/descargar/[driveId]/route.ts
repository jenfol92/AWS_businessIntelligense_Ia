/**
 * GET /api/products/[id]/documentos/descargar/[driveId]
 * Descarga binaria desde Google Drive (solo si el archivo pertenece al producto).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { downloadDriveFile, isDriveConfigured } from "@/modules/drive/googleDriveService";
import { productOwnsDriveDocument } from "@/modules/products/repositories/productDocumentsRepository";

type Params = { params: { id: string; driveId: string } };

export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  if (!isDriveConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Google Drive no está configurado.", drive_required: true },
      { status: 503 },
    );
  }

  const owns = await productOwnsDriveDocument(params.id, params.driveId);
  if (!owns) {
    return NextResponse.json(
      { ok: false, error: "Documento no vinculado a este producto" },
      { status: 404 },
    );
  }

  try {
    const file = await downloadDriveFile(params.driveId);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error descargando";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
