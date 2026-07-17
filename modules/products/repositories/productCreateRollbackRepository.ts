import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

const PRODUCT_CHILD_TABLES = [
  "producto_precios",
  "producto_costos",
  "producto_finanzas",
  "producto_logistica",
  "producto_ficha_tecnica",
  "producto_detalle",
] as const;

export async function rollbackCreatedProduct(productId: string): Promise<void> {
  const supabase = createSupabaseRouteClient();
  const failures: string[] = [];

  for (const table of PRODUCT_CHILD_TABLES) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("producto_id", productId);
    if (error) failures.push(`${table}: ${error.message}`);
  }

  const { error } = await supabase.from("productos").delete().eq("id", productId);
  if (error) failures.push(`productos: ${error.message}`);

  if (failures.length > 0) {
    throw new Error(`Rollback incompleto (${failures.join("; ")})`);
  }
}
