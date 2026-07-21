/**
 * Módulo   : orders
 * Archivo  : app/api/orders/[id]/proforma/route.ts
 * Qué hace : Previsualiza y versiona la proforma usando una única instantánea
 *            validada de la orden y sus líneas.
 */

import { NextResponse } from "next/server";
import {
  loadProformaData,
  prepareProformaVersion,
  renderProformaHtml,
  type ProformaDataSource,
} from "@/modules/orders/services/orderProformaData";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };
type SupabaseRouteClient = ReturnType<typeof createSupabaseRouteClient>;

function createProformaDataSource(
  supabase: SupabaseRouteClient,
): ProformaDataSource {
  return {
    async getOrder(orderId) {
      const { data, error } = await supabase
        .from("ordenes_compra")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();
      return {
        data: (data as Record<string, unknown> | null) ?? null,
        error: error ? { message: error.message } : null,
      };
    },
    async getItems(orderId) {
      const { data, error } = await supabase
        .from("orden_items")
        .select(
          "*, productos(sku, nombre, producto_detalle(imagen_url)), proveedores(nombre), lote_producto",
        )
        .eq("orden_id", orderId);
      return {
        data: (data as Record<string, unknown>[] | null) ?? null,
        error: error ? { message: error.message } : null,
      };
    },
  };
}

function failureResponse(
  result: {
    status: number;
    code: string;
    error: string;
    skus?: string[];
  },
) {
  return NextResponse.json(
    {
      ok: false,
      code: result.code,
      error: result.error,
      ...(result.skus ? { skus: result.skus } : {}),
    },
    { status: result.status },
  );
}

/**
 * Abre una versión guardada si existe. Sin `version` explícita y sin una
 * versión persistida, carga una vez orden + líneas y renderiza esa instantánea.
 */
export async function GET(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const requestedVersion = new URL(req.url).searchParams.get("version");
  let query = supabase
    .from("order_proforma_versions")
    .select("html_content, version")
    .eq("orden_id", params.id);

  if (requestedVersion) {
    const parsedVersion = Number(requestedVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
      return NextResponse.json(
        { ok: false, error: "Versión de proforma inválida" },
        { status: 400 },
      );
    }
    query = query.eq("version", parsedVersion);
  } else {
    query = query.order("version", { ascending: false }).limit(1);
  }

  const { data: versionData, error: versionError } =
    await query.maybeSingle();
  if (versionError) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROFORMA_VERSION_QUERY_FAILED",
        error: `No se pudo consultar la versión de la proforma: ${versionError.message}`,
      },
      { status: 500 },
    );
  }

  if (versionData) {
    return new Response(String(versionData.html_content), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Proforma-Version": String(versionData.version),
      },
    });
  }

  if (requestedVersion) {
    return NextResponse.json(
      { ok: false, error: "La versión solicitada no existe" },
      { status: 404 },
    );
  }

  const loaded = await loadProformaData(
    createProformaDataSource(supabase),
    params.id,
  );
  if (loaded.ok === false) return failureResponse(loaded);

  return new Response(renderProformaHtml(loaded.data, params.id), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Genera una nueva versión no firmada. Orden, líneas, validación y HTML usan
 * exactamente una misma carga de datos; ningún error o coste inválido llega a
 * create_order_proforma_version.
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }

  let body: { confirm_signed?: boolean } = {};
  try {
    body = (await req.json()) as { confirm_signed?: boolean };
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 },
    );
  }

  const prepared = await prepareProformaVersion(
    createProformaDataSource(supabase),
    params.id,
  );
  if (prepared.ok === false) return failureResponse(prepared);

  const proformaData = prepared.data;
  if (
    proformaData.ordenRec["proforma_firmada_url"] &&
    body.confirm_signed !== true
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "SIGNED_PROFORMA_EXISTS",
        error:
          "Existe una proforma firmada. Confirma expresamente la creación de una nueva versión no firmada.",
      },
      { status: 409 },
    );
  }

  const { data: createdVersion, error: versionError } = await supabase.rpc(
    "create_order_proforma_version",
    {
      p_order_id: params.id,
      p_html_content: prepared.htmlContent,
    },
  );

  if (versionError) {
    return NextResponse.json(
      { ok: false, error: versionError.message },
      { status: 400 },
    );
  }

  const versionRow = Array.isArray(createdVersion)
    ? createdVersion[0]
    : createdVersion;
  const version = Number(
    (versionRow as { version?: number } | null)?.version ?? 0,
  );
  if (!Number.isInteger(version) || version <= 0) {
    return NextResponse.json(
      { ok: false, error: "La RPC no devolvió una versión válida" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    version,
    url: `/api/orders/${encodeURIComponent(params.id)}/proforma?version=${version}`,
  });
}
