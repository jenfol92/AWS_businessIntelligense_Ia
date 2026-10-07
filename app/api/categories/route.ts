/**
 * API de categorías de producto.
 * GET  /api/categories — categorías activas con campos_config
 * POST /api/categories — crear categoría
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  createCategory,
  listActiveCategories,
} from "@/modules/categories/repositories/categoryRepository";
import type { CategoryCamposConfig } from "@/modules/categories/types/category.types";

export async function GET() {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const rows = await listActiveCategories();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error listando categorías.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const nombre = typeof raw.nombre === "string" ? raw.nombre.trim() : "";
  if (!nombre) {
    return NextResponse.json(
      { ok: false, error: "El nombre de la categoría es obligatorio." },
      { status: 400 },
    );
  }

  const descripcion =
    typeof raw.descripcion === "string" ? raw.descripcion.trim() : null;

  let campos_config: CategoryCamposConfig | undefined;
  if (raw.campos_config != null && typeof raw.campos_config === "object") {
    campos_config = raw.campos_config as CategoryCamposConfig;
  }

  try {
    const row = await createCategory({
      nombre,
      descripcion,
      campos_config: campos_config ?? { campos: [] },
    });
    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error creando categoría.";
    const status = msg.includes("Ya existe") ? 409 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
