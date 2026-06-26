// app/api/drive/route.ts
//
// Endpoint genérico legacy descontinuado.
// Documentos de producto → /api/products/[id]/documentos
// Documentos de contenedor → /api/containers/[id]/documentos

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Este endpoint está descontinuado. Usa /api/products/[id]/documentos o /api/containers/[id]/documentos.",
    },
    { status: 410 },
  );
}
