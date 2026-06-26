/**
 * API de proveedor individual.
 * GET    /api/suppliers/[id]
 * PUT    /api/suppliers/[id]
 * DELETE /api/suppliers/[id]
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  deleteSupplier,
  getSupplierById,
  updateSupplier,
} from "@/modules/suppliers/repositories/suppliersRepository";
import { validateSupplierInput } from "@/modules/suppliers/services/validateSupplierInput";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const supplier = await getSupplierById(params.id);
    if (!supplier) {
      return NextResponse.json(
        { ok: false, error: "Proveedor no encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, supplier });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error obteniendo proveedor.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
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

  const validated = validateSupplierInput(body);
  if (validated.ok === false) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  try {
    const supplier = await updateSupplier(params.id, validated.data);
    return NextResponse.json({ ok: true, supplier });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error actualizando proveedor.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    await deleteSupplier(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error eliminando proveedor.";
    const isConflict = msg.includes("No se puede eliminar");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isConflict ? 409 : 400 },
    );
  }
}
