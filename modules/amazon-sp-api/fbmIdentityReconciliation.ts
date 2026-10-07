import { buildFbmProductIdentities, type FbmProductIdentity } from "./fbmProductIdentityRepository.ts";

export type IdentityProduct = { id: unknown; sku: unknown; asin?: unknown; estado?: unknown };
type IdentityPair = [string, string];
export type FbmIdentityDiagnostics = {
  expectedCount: number; currentCount: number;
  removedBecauseDiscontinued: IdentityPair[]; unexpectedRemoved: IdentityPair[];
  unexpectedAdded: IdentityPair[]; skuChanged: IdentityPair[];
  duplicateIdentity: IdentityPair[]; invalidIdentity: IdentityPair[];
};

export function fbmIdentityKey(identities: FbmProductIdentity[]): string {
  if (!identities.length || new Set(identities.map(i => i.sellerSku)).size !== identities.length ||
    new Set(identities.map(i => i.productoId)).size !== identities.length ||
    identities.some(i => !validSku(i.sellerSku) || !i.productoId || i.skuLimpio !== i.sellerSku)) throw new Error("FBM_INVALID_IDENTITIES");
  return JSON.stringify(identities.map(i => [i.productoId, i.sellerSku]).sort((a, b) => a[0].localeCompare(b[0])));
}
function validSku(sku: unknown): sku is string {
  return typeof sku === "string" && Boolean(sku.trim()) && sku === sku.trim() && !/[\x00-\x1f\x7f]/.test(sku);
}
function validProduct(p: IdentityProduct): boolean {
  return typeof p.id === "string" && Boolean(p.id.trim()) && p.id === p.id.trim() && validSku(p.sku) && /^[A-Z0-9]{10}$/.test(String(p.asin ?? "").trim());
}

/** Only a confirmed business discontinuation of the same identity is an allowed removal. */
export function reconcileFbmIdentities(frozenKey: string | null, products: IdentityProduct[]) {
  const diagnostics: FbmIdentityDiagnostics = { expectedCount: 0, currentCount: 0, removedBecauseDiscontinued: [],
    unexpectedRemoved: [], unexpectedAdded: [], skuChanged: [], duplicateIdentity: [], invalidIdentity: [] };
  let expected: IdentityPair[];
  try {
    const parsed = JSON.parse(frozenKey ?? "null");
    if (!Array.isArray(parsed) || !parsed.length || parsed.some(p => !Array.isArray(p) || p.length !== 2 || typeof p[0] !== "string" || !p[0] || !validSku(p[1]))) throw new Error();
    expected = parsed;
  } catch { diagnostics.invalidIdentity.push(["", ""]); return { ok: false, identities: [], diagnostics }; }
  diagnostics.expectedCount = expected.length;
  const expectedById = new Map<string, string>(), expectedSkus = new Set<string>();
  for (const [id, sku] of expected) {
    if (expectedById.has(id) || expectedSkus.has(sku)) diagnostics.duplicateIdentity.push([id, sku]);
    expectedById.set(id, sku); expectedSkus.add(sku);
  }
  const productsById = new Map<string, IdentityProduct>();
  for (const p of products) {
    const id = String(p.id ?? "");
    if (productsById.has(id)) diagnostics.duplicateIdentity.push([id, String(p.sku ?? "")]);
    productsById.set(id, p);
  }
  for (const [id, sku] of expected) {
    const p = productsById.get(id);
    if (!p) { diagnostics.unexpectedRemoved.push([id, sku]); continue; }
    if (p.sku !== sku) { diagnostics.skuChanged.push([id, sku]); continue; }
    if (!validProduct(p)) { diagnostics.invalidIdentity.push([id, sku]); continue; }
    if (p.estado === "descatalogado") diagnostics.removedBecauseDiscontinued.push([id, sku]);
    else if (p.estado !== "activo") diagnostics.unexpectedRemoved.push([id, sku]);
  }
  const current = products.filter(p => p.estado === "activo" && validProduct(p));
  const skus = new Set<string>();
  for (const p of current) {
    const pair: IdentityPair = [String(p.id), String(p.sku)];
    if (skus.has(pair[1])) diagnostics.duplicateIdentity.push(pair);
    skus.add(pair[1]);
    if (!expectedById.has(pair[0])) diagnostics.unexpectedAdded.push(pair);
  }
  diagnostics.currentCount = current.length;
  const ok = current.length > 0 && [diagnostics.unexpectedRemoved, diagnostics.unexpectedAdded, diagnostics.skuChanged,
    diagnostics.duplicateIdentity, diagnostics.invalidIdentity].every(group => group.length === 0);
  return { ok, identities: ok ? buildFbmProductIdentities(current) : [], diagnostics };
}
