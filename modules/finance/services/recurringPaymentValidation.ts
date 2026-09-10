import { accountingDate } from "../utils/accountingDate";
import { validateDate, validateUuid } from "./unlinkedObligationsValidation";
import { UnlinkedObligationsApiError } from "./unlinkedObligationsApiErrors";

export function validateRecurringPayment(input: Record<string, unknown>, paying = false) {
  const fail = (message: string): never => { throw new UnlinkedObligationsApiError("INVALID_PAYMENT", message); };
  const allowed = paying
    ? ["idempotency_key", "installment_id", "template_id", "due_date", "amount_eur", "paid_date", "cash_account_id", "bank_reference"]
    : ["idempotency_key", "payment_type_id", "concept", "amount_eur", "cash_account_id", "date", "frequency", "end_date", "action"];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail("El formulario contiene campos no admitidos.");
  const amount = input.amount_eur;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) fail("Introduce un importe positivo con hasta dos decimales.");
  const base = { idempotency_key: validateUuid(input.idempotency_key), cash_account_id: validateUuid(input.cash_account_id), amount_eur: amount };
  if (paying) {
    if (Boolean(input.installment_id) === Boolean(input.template_id)) fail("Selecciona un vencimiento.");
    const paidDate = validateDate(input.paid_date, "paid_date");
    if (paidDate > accountingDate()) fail("La fecha de un pago realizado no puede ser futura.");
    if (input.bank_reference != null && (typeof input.bank_reference !== "string" || input.bank_reference.length > 200)) fail("Referencia no válida.");
    return { ...base, paid_date: paidDate, bank_reference: input.bank_reference ?? null,
      ...(input.installment_id ? { installment_id: validateUuid(input.installment_id) }
        : { template_id: validateUuid(input.template_id), due_date: validateDate(input.due_date, "due_date") }) };
  }
  const date = validateDate(input.date, "date");
  const end = input.end_date == null ? null : validateDate(input.end_date, "end_date");
  if (end && end < date) fail("La finalización debe ser posterior al inicio.");
  if (![0, 1, 3, 12].includes(input.frequency as number)) fail("Frecuencia no válida.");
  if (typeof input.concept !== "string" || !input.concept.trim() || input.concept.trim().length > 200) fail("Introduce un concepto de hasta 200 caracteres.");
  if (!["pending", "paid"].includes(input.action as string)) fail("Acción no válida.");
  if (input.action === "paid" && date > accountingDate()) fail("Guarda los pagos futuros como pendientes.");
  return { ...base, payment_type_id: validateUuid(input.payment_type_id), concept: (input.concept as string).trim(),
    date, frequency: input.frequency, end_date: end, action: input.action };
}
