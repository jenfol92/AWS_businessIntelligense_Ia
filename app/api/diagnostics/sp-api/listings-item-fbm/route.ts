import { NextResponse } from "next/server";

import { loadSpApiConfig } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  AMAZON_ES_MARKETPLACE_ID,
  getListingsItem,
} from "@/modules/amazon-sp-api/listingsItemsClient";
import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";

export const dynamic = "force-dynamic";
const ALAIA_FBM_PRODUCT_ID = "614e8e63-b23a-4c4f-8915-abf19a86702f";
const ALAIA_FBM_PRODUCT_SKU = "8436616610104";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Diagnostico no disponible en produccion." },
      { status: 404 },
    );
  }

  const config = loadSpApiConfig();
  if (!config.sellerId) {
    return NextResponse.json({
      ok: false,
      sellerIdSource: "MISSING",
      sellerIdPresent: false,
      productoId: ALAIA_FBM_PRODUCT_ID,
      sellerSku: ALAIA_FBM_PRODUCT_SKU,
      marketplaceId: AMAZON_ES_MARKETPLACE_ID,
      amazonRequests: 0,
    }, { status: 400 });
  }

  try {
    const result = await getListingsItem({ sellerSku: ALAIA_FBM_PRODUCT_SKU, marketplaceId: AMAZON_ES_MARKETPLACE_ID, request: spApiRequest, loadConfig: () => config });
    return NextResponse.json({
      ok: true,
      sellerIdSource: "AMAZON_SELLER_ID",
      sellerIdPresent: true,
      result,
    });
  } catch (error) {
    const mapped = mapGenericError(error);
    return NextResponse.json({
      ok: false,
      sellerIdSource: "AMAZON_SELLER_ID",
      sellerIdPresent: true,
      productoId: ALAIA_FBM_PRODUCT_ID,
      sellerSku: ALAIA_FBM_PRODUCT_SKU,
      marketplaceId: AMAZON_ES_MARKETPLACE_ID,
      amazonRequests: 1,
      error: {
        status: mapped.status ?? null,
        code: mapped.code,
        message: mapped.message,
        details: mapped.details ?? null,
      },
    }, { status: mapped.status ?? 500 });
  }
}
