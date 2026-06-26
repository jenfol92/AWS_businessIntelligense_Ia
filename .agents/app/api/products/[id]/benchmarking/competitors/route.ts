// app/api/products/[id]/benchmarking/competitors/route.ts

import { NextResponse } from "next/server";
import { findProductCoreById } from "@/modules/products/repositories/productCoreRepository";
import { getProductBenchmarkCompetitors } from "@/modules/products/services/getProductBenchmarkCompetitors";

type Params = {
  params: {
    id: string;
  };
};

function toInt(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function GET(req: Request, { params }: Params) {
  try {
    const productId = params.id?.trim();
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Missing product id" },
        { status: 400 },
      );
    }

    const product = await findProductCoreById(productId);

    const url = new URL(req.url);
    const marketplaceCountry =
      (url.searchParams.get("marketplaceCountry") ?? "ES").trim() || "ES";
    const limit = toInt(url.searchParams.get("limit"));

    const result = await getProductBenchmarkCompetitors(
      productId,
      product.sku,
      marketplaceCountry,
      limit,
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando competidores de benchmarking";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
