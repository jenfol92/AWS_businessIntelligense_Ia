import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { startAllOrdersSync, findOpenAllOrdersSyncJobId, resumeAllOrdersSync } from "./allOrdersSalesSyncService";
import { rollingRange, summarizeCoverage } from "./allOrdersSyncPolicy";
import { supabaseAdmin } from "@/server/supabase/adminClient";
export function ordersCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim(); if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected,supplied);
}
export async function ordersRecovery(request: Request) {
  if (!ordersCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const jobId = await findOpenAllOrdersSyncJobId();
    if (!jobId) return NextResponse.json({ ok: true, status: "IDLE" });
    const result = await resumeAllOrdersSync(jobId);
    return NextResponse.json(result, { status: result.status === "FAILED" ? 422 : result.status === "PENDING" ? 202 : 200 });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Orders recovery failed" }, { status: 503 }); }
}
export async function ordersGeneration(request: Request) {
  if (!ordersCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await startAllOrdersSync(rollingRange(new Date()));
    return NextResponse.json(result, { status: result.status === "FAILED" ? 422 : result.status === "PENDING" ? 202 : 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Orders generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("RANGE_CONFLICT") ? 409 : 503 });
  }
}
export async function ordersCoverage(request: Request) {
  if (!ordersCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const marketplace = params.get("marketplaceId"), from = params.get("fromDate"), to = params.get("toDate");
  if (!marketplace || !from || !to) return NextResponse.json({ ok: false, error: "marketplaceId/fromDate/toDate required" }, { status: 400 });
  try {
    const { data, error } = await supabaseAdmin.from("amazon_orders_coverage").select("*").eq("marketplace_id",marketplace).lte("start_date",to).gte("end_date",from).order("start_date");
    if (error) throw new Error(error.message);
    return NextResponse.json({ marketplaceId: marketplace, fromDate: from, toDate: to, ...summarizeCoverage(from,to,data ?? []), evidence: data });
  } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Coverage failed" }, { status: 400 }); }
}
