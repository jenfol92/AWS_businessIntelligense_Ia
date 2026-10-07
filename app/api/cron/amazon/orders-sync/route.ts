// Compatibility entrypoint: recovery only. Generation has its own explicit POST.
import { ordersRecovery } from "@/modules/amazon-sp-api/allOrdersHttp";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = ordersRecovery;
export const GET = ordersRecovery;
