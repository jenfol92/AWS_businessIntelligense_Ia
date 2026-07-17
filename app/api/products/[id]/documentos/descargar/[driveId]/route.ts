/**
 * GET /api/products/[id]/documentos/descargar/[driveId]
 * Descarga binaria desde Google Drive (solo si el archivo pertenece al producto).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  DriveFolderNotViewableError,
  downloadDriveFile,
  isDriveConfigured,
} from "@/modules/drive/googleDriveService";
import { productOwnsDriveDocument } from "@/modules/products/repositories/productDocumentsRepository";

type Params = { params: { id: string; driveId: string } };

function sanitizeHeaderFileName(fileName: string): string {
  const clean = fileName
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/:*?<>|]/g, "-")
    .trim();
  return clean || "documento";
}

function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const safeName = sanitizeHeaderFileName(fileName);
  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function shouldOpenInline(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

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
    const inline = shouldOpenInline(file.mimeType);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": contentDisposition(
          inline ? "inline" : "attachment",
          file.fileName,
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DriveFolderNotViewableError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          error: e.message,
        },
        { status: 409 },
      );
    }
    const msg = e instanceof Error ? e.message : "Error descargando";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
