// app/api/products/[id]/benchmarking/selection/route.ts

import { NextResponse } from "next/server";
import { findProductCoreById } from "@/modules/products/repositories/productCoreRepository";
import {
  saveProductBenchmarkSelection,
  validatePutProductBenchmarkSelectionBody,
} from "@/modules/products/services/saveProductBenchmarkSelection";

type Params = {
  params: {
    id: string;
  };
};

export async function PUT(req: Request, { params }: Params) {
  try {
    const productId = params.id?.trim();
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Missing product id" },
        { status: 400 },
      );
    }

    await findProductCoreById(productId);

    const body = await req.json();
    const payload = validatePutProductBenchmarkSelectionBody(body);
    const { saved } = await saveProductBenchmarkSelection(productId, payload);

    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error guardando selección de competidores";
    const status = message.includes("inválido") || message.includes("obligatorio")
      ? 400
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
