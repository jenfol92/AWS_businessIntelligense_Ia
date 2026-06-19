// app/api/planning/products/[productId]/supply-config/route.ts

import { NextResponse } from "next/server";
import { getProductSupplyConfig } from "@/modules/planning/services/getProductSupplyConfig";
import { upsertProductSupplyConfig } from "@/modules/planning/services/upsertProductSupplyConfig";
import type { ProductSupplyConfigUpsertBody } from "@/modules/planning/types";

type RouteContext = {
  params: {
    productId: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(
  raw: Record<string, unknown>,
  key: string
): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`El campo "${key}" debe ser un número finito.`);
  }
  return v;
}

function readNullableStringField(
  raw: Record<string, unknown>,
  key: string
): string | null {
  const v = raw[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    throw new Error(`El campo "${key}" debe ser string o null.`);
  }
  const t = v.trim();
  return t === "" ? null : t;
}

function readNullableId(
  raw: Record<string, unknown>,
  key: string
): string | null {
  const v = raw[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    throw new Error(`El campo "${key}" debe ser string o null.`);
  }
  const t = v.trim();
  return t === "" ? null : t;
}

function parseProductSupplyConfigUpsertBody(
  raw: unknown,
  urlProductId: string
): ProductSupplyConfigUpsertBody {
  if (!isRecord(raw)) {
    throw new Error("El cuerpo debe ser un objeto JSON.");
  }

  if (
    "productoId" in raw &&
    raw.productoId !== null &&
    raw.productoId !== undefined
  ) {
    if (typeof raw.productoId !== "string") {
      throw new Error('El campo "productoId" debe ser string.');
    }
    if (raw.productoId.trim() !== urlProductId) {
      throw new Error(
        "Si se envía productoId en el body, debe coincidir con el de la URL."
      );
    }
  }

  return {
    leadTimeProduccionDias: readFiniteNumber(
      raw,
      "leadTimeProduccionDias"
    ),
    leadTimeTransporteDias: readFiniteNumber(
      raw,
      "leadTimeTransporteDias"
    ),
    leadTimeAduanaDias: readFiniteNumber(raw, "leadTimeAduanaDias"),
    stockSeguridadDias: readFiniteNumber(raw, "stockSeguridadDias"),
    frecuenciaReposicionDias: readFiniteNumber(
      raw,
      "frecuenciaReposicionDias"
    ),
    moq: readFiniteNumber(raw, "moq"),
    masterCartonQty: readFiniteNumber(raw, "masterCartonQty"),
    puertoOrigen: readNullableStringField(raw, "puertoOrigen"),
    puertoDestino: readNullableStringField(raw, "puertoDestino"),
    proveedorId: readNullableId(raw, "proveedorId"),
    agenteId: readNullableId(raw, "agenteId"),
  };
}

export async function GET(
  _req: Request,
  context: RouteContext
) {
  try {
    const productId = context.params.productId?.trim() ?? "";
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Falta productId en la ruta." },
        { status: 400 }
      );
    }

    const result = await getProductSupplyConfig(productId);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando configuración de suministro";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  context: RouteContext
) {
  try {
    const productId = context.params.productId?.trim() ?? "";
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Falta productId en la ruta." },
        { status: 400 }
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Body JSON inválido." },
        { status: 400 }
      );
    }

    const body = parseProductSupplyConfigUpsertBody(raw, productId);
    const result = await upsertProductSupplyConfig(productId, body);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error guardando configuración";

    const isClientError =
      error instanceof Error &&
      (message.startsWith("El campo") ||
        message.startsWith("El cuerpo") ||
        message.startsWith("Si se envía"));

    return NextResponse.json(
      { ok: false, error: message },
      { status: isClientError ? 400 : 500 }
    );
  }
}