// app/api/products/catalog/route.ts

import { NextResponse } from "next/server";
import { getProductCatalog } from "@/modules/products/services/getProductCatalog";
import { parseProductCatalogQuery } from "@/modules/products/schemas/productCatalogQuerySchema";

export async function GET(req: Request) {
  try {
    const query = parseProductCatalogQuery(req);
    const result = await getProductCatalog(query);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error cargando catálogo";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}