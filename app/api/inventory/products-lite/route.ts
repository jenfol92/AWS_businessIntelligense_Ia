/**
 * GET /api/inventory/products-lite
 * Lista ligera de productos activos para desbloquear la carga inicial del detalle.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { fetchInventoryProductsLite } from "@/modules/inventory/repositories/inventoryRepository";

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
    const rows = await fetchInventoryProductsLite();
    return NextResponse.json({
      ok: true,
      products: rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        nombre: row.nombre,
        parent_id: row.parent_id,
        proveedor_id: row.proveedor_id,
        estado: row.estado,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al cargar productos";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
