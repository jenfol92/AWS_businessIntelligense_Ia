import { NextResponse } from "next/server";
import { resolveOrderLeadTimeSuggestionsService } from "@/modules/orders/services/resolveOrderLeadTimeSuggestionsService";
import type { OrderLeadTimeSuggestionRequest } from "@/modules/orders/types/orderLeadTimeSuggestion.types";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

function parseItems(body: unknown): OrderLeadTimeSuggestionRequest["items"] | null {
  if (!body || typeof body !== "object") return null;
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const parsed: OrderLeadTimeSuggestionRequest["items"] = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as { producto_id?: unknown; proveedor_id?: unknown };
      if (typeof raw.producto_id !== "string" || !raw.producto_id.trim()) return null;
      return {
        producto_id: raw.producto_id.trim(),
        proveedor_id:
          typeof raw.proveedor_id === "string" && raw.proveedor_id.trim()
            ? raw.proveedor_id.trim()
            : null,
      };
    })
    .filter((item): item is { producto_id: string; proveedor_id: string | null } => item != null);

  return parsed;
}

export async function POST(req: Request) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON invalido" }, { status: 400 });
  }

  const items = parseItems(body);
  if (!items) {
    return NextResponse.json({ ok: false, error: "items debe ser un array" }, { status: 400 });
  }

  try {
    const suggestions = await resolveOrderLeadTimeSuggestionsService(items);
    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error resolviendo sugerencias";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
