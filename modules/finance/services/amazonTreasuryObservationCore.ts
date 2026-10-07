import { createHash } from "node:crypto";
import type { FinancesTransaction } from "../../amazon-sp-api/financesClient";

const IDS: Record<string, string> = {
  A1RKKUPIHCS9HS: "ES", A13V1IB3VIYZZH: "FR", A1PA6795UKMFR9: "DE", APJ6JRA9NG5V4: "IT",
  A1F83G8C2ARO7P: "GB", A1C3SOZRARQ6R3: "PL", A2NODRKZP88ZB9: "SE", A1805IZSGTT6HS: "NL",
  A28R8C7NBKEWEA: "IE", AMEN7PMS3EDWL: "BE",
};
const NAMES: Record<string, string> = {
  "amazon.es": "ES", "amazon.fr": "FR", "amazon.de": "DE", "amazon.it": "IT", "amazon.co.uk": "GB",
  "amazon.pl": "PL", "amazon.se": "SE", "amazon.nl": "NL", "amazon.ie": "IE", "amazon.com.be": "BE",
};

export function signals(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const code = IDS[value] ?? NAMES[value.trim().toLowerCase()];
    if (code) out.add(code);
  } else if (Array.isArray(value)) {
    for (const item of value) signals(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) signals(item, out);
  }
  return out;
}

export function resolveObservationMarketplace(transactions: FinancesTransaction[]): string {
  const found = Array.from(signals(transactions));
  return found.length === 1 ? found[0] : "UNRESOLVED";
}

export function transactionFields(transaction: FinancesTransaction) {
  const t = transaction as Record<string, unknown>;
  const money = (t.totalAmount ?? {}) as Record<string, unknown>;
  return {
    id: typeof t.transactionId === "string" ? t.transactionId : null,
    currency: typeof money.currencyCode === "string" ? money.currencyCode.toUpperCase() : null,
    amount: Number(money.currencyAmount),
  };
}

export function materialKey(state: string, identity: string, observedAt: string, material: unknown) {
  const bucket = observedAt.slice(0, 10);
  const hash = createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
  return `amazon-observation:v1:${state}:${identity}:${bucket}:${hash}`;
}
