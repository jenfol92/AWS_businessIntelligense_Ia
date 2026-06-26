// app/api/products/catalog/options/route.ts

import { NextResponse } from "next/server";
import { getProductCatalogOptions } from "@/modules/products/services/getProductCatalogOptions";

export async function GET() {
  try {
    const result = await getProductCatalogOptions();

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error cargando filtros";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}