// app/api/imports/amazon-sales-csv/route.ts

import { NextRequest, NextResponse } from "next/server";
import { importAmazonSalesCsv } from "@/modules/imports/amazon-sales/importer";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    const result = await importAmazonSalesCsv(file);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 }
    );
  }
}