import { NextResponse } from "next/server";
import { updateConfirmedOrderService } from "@/modules/orders/services/updateConfirmedOrderService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  let body: Parameters<typeof updateConfirmedOrderService>[1];
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  try {
    const orden = await updateConfirmedOrderService(params.id, body);
    return NextResponse.json({ ok: true, orden });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error actualizando orden confirmada.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
