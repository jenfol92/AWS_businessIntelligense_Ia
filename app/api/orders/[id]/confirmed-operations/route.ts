import { NextResponse } from "next/server";
import { updateConfirmedOrderOperationsService } from "@/modules/orders/services/updateConfirmedOrderOperationsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

/** PATCH operativo de una orden confirmada; no acepta ni modifica líneas. */
export async function PATCH(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  try {
    const orden = await updateConfirmedOrderOperationsService(params.id, body);
    return NextResponse.json({ ok: true, orden });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error actualizando la operación confirmada.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
