// modules/products/repositories/productSupplierRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

// Tabla: proveedores.
// Se usa desde la ficha de producto para mostrar datos del proveedor asociado.
export async function findSupplierById(supplierId: string | null) {
  if (!supplierId) return null;

  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("proveedores")
    .select(`
      id,
      nombre,
      pais,
      ciudad,
      provincia,
      puerto_preferido,
      dias_produccion_estandar,
      dias_transito_estandar,
      agente_id,
      agente:agentes_compra(
        id,
        empresa,
        contacto,
        email,
        telefono
      )
    
    `)
    .eq("id", supplierId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}