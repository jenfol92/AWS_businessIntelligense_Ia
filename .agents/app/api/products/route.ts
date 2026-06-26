// app/api/products/route.ts

import { NextResponse } from "next/server";
import { createProduct } from "@/modules/products/services/createProduct";

// POST /api/products
// Crea un producto nuevo.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createProduct(body);

    const status = result.ok ? 201 : 400;

    return NextResponse.json(result, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error creando producto";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}