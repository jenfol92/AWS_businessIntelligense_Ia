export type PendingPaymentOperation = {
  operationId: string;
  paying: boolean;
  body: string;
};
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (scope: string) => `finance.recurring.pending.v1:${scope}`;

/** Caller holds the Web Lock for this scope when reserving/clearing. Never expire an uncertain payment. */
export function readPaymentOperation(storage: StorageAccess, scope: string): PendingPaymentOperation | null {
  const raw = storage.getItem(key(scope));
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.operationId !== "string" || typeof value.paying !== "boolean"
    || typeof value.body !== "string" || JSON.parse(value.body).idempotency_key !== value.operationId) {
    throw new Error("No se puede recuperar la operación pendiente. No se iniciará otro pago.");
  }
  return value;
}

export function reservePaymentOperation(storage: StorageAccess, scope: string, operation: PendingPaymentOperation) {
  const existing = readPaymentOperation(storage, scope);
  if (existing) return existing;
  storage.setItem(key(scope), JSON.stringify(operation));
  return operation;
}

export function clearPaymentOperation(storage: StorageAccess, scope: string, operationId: string) {
  const existing = readPaymentOperation(storage, scope);
  if (existing && existing.operationId !== operationId) throw new Error("Existe otra operación pendiente; no se borrará.");
  storage.removeItem(key(scope));
}

export type PaymentAttemptResult = { state: "confirmed" | "rejected" | "uncertain"; message?: string };
/** An uncertain attempt is never discarded on a later error or a not_found status. */
export async function attemptPaymentOperation(
  storage: StorageAccess, scope: string, operation: PendingPaymentOperation, previouslyUncertain: boolean,
  send: (operation: PendingPaymentOperation) => Promise<Pick<Response, "ok" | "json">>,
): Promise<PaymentAttemptResult> {
  try {
    const response = await send(operation);
    const json = await response.json();
    if (response.ok && json.ok === true && json.data
      && (json.data.payment_id || json.data.template_id || json.data.obligation_id)) {
      clearPaymentOperation(storage, scope, operation.operationId);
      return { state: "confirmed" };
    }
    if (!previouslyUncertain && !response.ok && json.ok === false && json.definitiveRejection === true) {
      clearPaymentOperation(storage, scope, operation.operationId);
      return { state: "rejected", message: json.error };
    }
    return { state: "uncertain", message: json.error ?? "No se ha confirmado la operación." };
  } catch {
    return { state: "uncertain", message: "Resultado incierto. Comprueba el estado o reintenta la misma operación." };
  }
}
