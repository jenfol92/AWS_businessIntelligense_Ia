// app/api/planning/products/[productId]/supply-config/forecast/route.ts

import { NextResponse } from "next/server";
import {
  parseProductForecastConfigUpsertBody,
  updateProductForecastConfig,
} from "@/modules/planning/services/updateProductForecastConfig";
import { getProductSupplyConfig } from "@/modules/planning/services/getProductSupplyConfig";

type RouteContext = {
  params: {
    productId: string;
  };
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const productId = context.params.productId?.trim() ?? "";
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Falta productId en la ruta." },
        { status: 400 },
      );
    }

    const result = await getProductSupplyConfig(productId);
    const { config } = result;

    return NextResponse.json({
      ok: true,
      config: {
        forecastMethod: config.forecastMethod,
        forecastMixOwnWeight: config.forecastMixOwnWeight,
        forecastMixCompetitorWeight: config.forecastMixCompetitorWeight,
        competitorCapturePct: config.competitorCapturePct,
        stockoutCorrectionEnabled: config.stockoutCorrectionEnabled,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error cargando configuración de forecast";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const productId = context.params.productId?.trim() ?? "";
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "Falta productId en la ruta." },
        { status: 400 },
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Body JSON inválido." },
        { status: 400 },
      );
    }

    const body = parseProductForecastConfigUpsertBody(raw);
    const result = await updateProductForecastConfig(productId, body);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error guardando configuración";

    const isClientError =
      error instanceof Error &&
      (message.startsWith("El cuerpo") ||
        message.startsWith("forecast") ||
        message.includes("debe estar entre"));

    return NextResponse.json(
      { ok: false, error: message },
      { status: isClientError ? 400 : 500 },
    );
  }
}
