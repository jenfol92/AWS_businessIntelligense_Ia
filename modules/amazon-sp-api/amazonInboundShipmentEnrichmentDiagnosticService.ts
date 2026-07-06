import type { SupabaseClient } from "@supabase/supabase-js";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";

type Attempt = {
  source: string;
  ok: boolean;
  status?: number;
  message?: string;
  payload?: unknown;
};

function deniedMessage(source: string): string {
  return `${source} denied: revisar permisos/roles/SP-API`;
}

async function captureAttempt(source: string, fn: () => Promise<unknown>): Promise<Attempt> {
  try {
    const payload = await fn();
    return { source, ok: true, payload };
  } catch (error) {
    const mapped = mapGenericError(error);
    return {
      source,
      ok: false,
      status: mapped.status,
      message: mapped.status === 403 ? deniedMessage(source) : mapped.message,
      payload: mapped.details,
    };
  }
}

export async function buildAmazonInboundShipmentEnrichmentDiagnostic(
  supabase: SupabaseClient,
  shipmentId: string,
) {
  const { data: header } = await supabase
    .from("amazon_inbound_shipments")
    .select("*")
    .eq("shipment_id", shipmentId)
    .maybeSingle();

  const { data: rows, error: rowsError } = await supabase
    .from("amazon_envios")
    .select("shipment_id, inbound_plan_id, raw")
    .eq("shipment_id", shipmentId)
    .limit(20);

  if (rowsError) throw new Error(rowsError.message);

  const inboundPlanId =
    String((header as Record<string, unknown> | null)?.inbound_plan_id ?? "").trim()
    || String(((rows ?? [])[0] as Record<string, unknown> | undefined)?.inbound_plan_id ?? "").trim();

  const attempts: Attempt[] = [];

  attempts.push({
    source: "persisted.amazon_envios.raw",
    ok: true,
    payload: {
      header: header ?? null,
      sample_rows: rows ?? [],
    },
  });

  attempts.push(
    await captureAttempt("v0.getShipmentItemsByShipmentId", () =>
      spApiRequest({
        method: "GET",
        path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
      }),
    ),
  );

  if (inboundPlanId) {
    attempts.push(
      await captureAttempt("v2024.listInboundPlanShipments", () =>
        spApiRequest({
          method: "GET",
          path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
            inboundPlanId,
          )}/shipments`,
        }),
      ),
    );
    attempts.push(
      await captureAttempt("v2024.listTransportationOptions", () =>
        spApiRequest({
          method: "GET",
          path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
            inboundPlanId,
          )}/transportationOptions`,
        }),
      ),
    );
  } else {
    attempts.push({
      source: "v2024",
      ok: false,
      message: "v2024 no consultado porque falta inbound_plan_id.",
    });
  }

  return {
    shipment_id: shipmentId,
    inbound_plan_id: inboundPlanId || null,
    v2024_diagnostic: {
      inbound_plan_id: inboundPlanId || null,
      consulted: Boolean(inboundPlanId),
      message: inboundPlanId
        ? "v2024 consultado con inbound_plan_id sincronizado."
        : "v2024 no consultado porque falta inbound_plan_id.",
      investigation_notes: [
        "Comprobar si inbound_plan_id aparece en otro endpoint SP-API de Fulfillment Inbound.",
        "Comprobar si Seller Central o documentos del envio exponen el inbound plan id.",
        "Comprobar si existe un informe Amazon que relacione shipment_id con inbound_plan_id.",
      ],
    },
    attempts,
    ui_status: attempts.some((attempt) => attempt.ok && attempt.source.startsWith("v2024"))
      ? "Datos Amazon disponibles"
      : attempts.some((attempt) => attempt.status === 403)
        ? "Pendiente permisos v2024"
        : "Datos Amazon parciales",
    finances_settlement: {
      status: "proposal_only",
      message:
        "Coste logistico Amazon pendiente de conciliacion. Para importarlo haria falta diagnostico de Settlement/Finances con fuente Amazon trazable.",
    },
  };
}
