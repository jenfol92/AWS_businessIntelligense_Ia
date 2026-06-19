/**
 * API de proveedores — listado y creación.
 * GET  /api/suppliers?q=&pais=&puerto=&agente=&completitud=
 * POST /api/suppliers
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  createSupplier,
  listSuppliers,
} from "@/modules/suppliers/repositories/suppliersRepository";
import { validateSupplierInput } from "@/modules/suppliers/services/validateSupplierInput";
import type { SupplierListFilters } from "@/modules/suppliers/types/supplier.types";

function parseListFilters(url: URL): SupplierListFilters {
  return {
    q: url.searchParams.get("q")?.trim() || undefined,
    pais: url.searchParams.get("pais")?.trim() || undefined,
    puerto: url.searchParams.get("puerto")?.trim() || undefined,
    agente: url.searchParams.get("agente")?.trim() || undefined,
    completitud: url.searchParams.get("completitud")?.trim() || undefined,
  };
}

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const filters = parseListFilters(new URL(req.url));
    const suppliers = await listSuppliers(filters);
    return NextResponse.json({ ok: true, suppliers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error listando proveedores.";
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

  const validated = validateSupplierInput(body);
  if (validated.ok === false) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  try {
    const supplier = await createSupplier(validated.data);
    return NextResponse.json({ ok: true, supplier }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error creando proveedor.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
