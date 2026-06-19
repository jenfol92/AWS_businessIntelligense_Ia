/**
 * POST /api/storage/product-image
 * Sube la imagen principal del producto a Supabase Storage.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { supabaseAdmin } from "@/server/supabase/adminClient";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = createSupabaseRouteClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }

  let form: FormData;

  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "FormData inválido" },
      { status: 400 },
    );
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Falta el archivo" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "La imagen supera 5 MB" },
      { status: 400 },
    );
  }

  const originalName = (file.name || "image.webp").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );

  // Raíz del bucket: sin carpetas products/, SKU ni temp-*.
  const path = `${Date.now()}-${originalName}`;

  const bytes = new Uint8Array(await file.arrayBuffer());

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
    });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  const { data: publicData } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  const publicUrl = publicData?.publicUrl ?? null;

  if (!publicUrl) {
    return NextResponse.json(
      { ok: false, error: "No se pudo obtener URL pública" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    path: data.path,
    publicUrl,
  });
}