// app/api/ai/chat/route.ts

import { NextResponse } from "next/server";
import { runBusinessAgent } from "@/modules/ai/agent/businessAgent";

export async function POST(req: Request) {
  const body = await req.json();

  const result = await runBusinessAgent({
    message: body.message,
    userId: body.userId,
  });

  return NextResponse.json(result);
}