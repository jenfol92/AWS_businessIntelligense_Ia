// app/api/products/[id]/form/route.ts

import { NextResponse } from "next/server";
import { getProductForm } from "@/modules/products/services/getProductForm";

type RouteParams = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const result = await getProductForm(params.id);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando formulario de producto";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}