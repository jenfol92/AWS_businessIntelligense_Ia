// app/api/products/[id]/route.ts

import { NextResponse } from "next/server";
import { getProductDetail } from "@/modules/products/services/getProductDetail";
import { updateProduct } from "@/modules/products/services/updateProduct";

type Params = {
  params: {
    id: string;
  };
};

function toInt(value: string | null, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(req: Request, { params }: Params) {
  try {
    const productId = params.id;

    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Missing product id" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);

    const windowDays = toInt(url.searchParams.get("windowDays"), 30);

    const paisRaw = url.searchParams.get("pais") ?? "ALL";
    const pais = paisRaw.trim() === "" ? "ALL" : paisRaw.trim().toUpperCase();

    const canalRaw = url.searchParams.get("canal") ?? "ALL";
    const canalUpper = canalRaw.trim().toUpperCase();
    const canal =
      canalUpper === "FBA" || canalUpper === "FBM" ? canalUpper : "ALL";

    const data = await getProductDetail({
      productId,
      windowDays,
      pais,
      canal,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando ficha de producto";

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

/** PUT /api/products/[id] — actualiza producto completo desde el formulario. */
export async function PUT(req: Request, { params }: Params) {
  try {
    const productId = params.id?.trim();
    if (!productId) {
      return NextResponse.json({ ok: false, error: "ID obligatorio" }, { status: 400 });
    }

    const body = await req.json();
    const result = await updateProduct(productId, body);
    const status = result.ok ? 200 : 400;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error actualizando producto";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}