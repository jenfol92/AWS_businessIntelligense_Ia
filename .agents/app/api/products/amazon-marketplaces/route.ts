import { NextResponse } from "next/server";
import { findAmazonMarketplaces } from "@/modules/products/repositories/amazonMarketplacesRepository";
import { mapAmazonMarketplaceCatalogRow } from "@/modules/products/mappers/amazonSetupMapper";
import type { AmazonMarketplaceCatalog } from "@/modules/products/types/product-amazon.types";

export async function GET() {
  try {
    const raw = await findAmazonMarketplaces();
    const rows: AmazonMarketplaceCatalog[] = [];
    for (const row of raw) {
      const mapped = mapAmazonMarketplaceCatalogRow(row);
      if (mapped) rows.push(mapped);
    }
    return NextResponse.json({ ok: true as const, rows });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando catálogo Amazon";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
