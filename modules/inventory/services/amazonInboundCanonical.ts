export type NormalizedAmazonInboundStatus =
  | "PLANNED"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CHECKED_IN"
  | "RECEIVING"
  | "CLOSED"
  | "CANCELLED"
  | "UNKNOWN";

export function normalizeAmazonInboundStatus(rawStatus: string | null | undefined): NormalizedAmazonInboundStatus {
  const raw = String(rawStatus ?? "").trim().toUpperCase();
  if (raw === "WORKING") return "PLANNED";
  if (raw === "CANCELLED" || raw === "DELETED") return "CANCELLED";
  if (["READY_TO_SHIP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING", "CLOSED"].includes(raw)) {
    return raw as NormalizedAmazonInboundStatus;
  }
  return "UNKNOWN";
}

export type InboundEtaEvidence = {
  etaDate: string | null;
  etaSource: "AMAZON_EXPLICIT" | "CARRIER_EXPLICIT" | "ERP_ESTIMATED" | "UNAVAILABLE";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
};

export function resolveInboundEtaEvidence(input: {
  amazonExplicit?: string | null;
  carrierExplicit?: string | null;
  erpEstimated?: string | null;
}): InboundEtaEvidence {
  if (input.amazonExplicit) return { etaDate: input.amazonExplicit, etaSource: "AMAZON_EXPLICIT", confidence: "HIGH" };
  if (input.carrierExplicit) return { etaDate: input.carrierExplicit, etaSource: "CARRIER_EXPLICIT", confidence: "HIGH" };
  if (input.erpEstimated) return { etaDate: input.erpEstimated, etaSource: "ERP_ESTIMATED", confidence: "LOW" };
  return { etaDate: null, etaSource: "UNAVAILABLE", confidence: "UNAVAILABLE" };
}

export function inboundQuantityQuality(expected: number, received: number) {
  return {
    expected,
    received,
    overReceived: received > expected,
    difference: received - expected,
  };
}
