import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelUnlinkedObligation,
  createUnlinkedObligation,
  createUnlinkedObligationTemplate,
  generateUnlinkedObligationOccurrences,
  replaceUnpaidInstallmentPlan,
  updatePendingUnlinkedObligation,
  updateUnlinkedObligationTemplate,
} from "../repositories/unlinkedObligationsCommandsRepository";
import {
  validateCancellation,
  validateCreateObligation,
  validateCreateTemplate,
  validateGeneration,
  validateMetadataUpdate,
  validateReplacementPlan,
  validateUpdateTemplate,
  validateUuid,
} from "./unlinkedObligationsValidation";

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function mapRpcResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapRpcResponse);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [camelKey(key), mapRpcResponse(item)]));
  }
  return value;
}

export async function createUnlinkedObligationCommand(input: unknown, client: SupabaseClient) {
  return mapRpcResponse(await createUnlinkedObligation(client, validateCreateObligation(input)));
}

export async function updateUnlinkedObligationMetadataCommand(id: unknown, input: unknown, client: SupabaseClient) {
  return mapRpcResponse(await updatePendingUnlinkedObligation(client, validateUuid(id), validateMetadataUpdate(input)));
}

export async function replaceUnlinkedInstallmentPlanCommand(id: unknown, input: unknown, client: SupabaseClient) {
  return mapRpcResponse(await replaceUnpaidInstallmentPlan(client, validateUuid(id), validateReplacementPlan(input)));
}

export async function cancelUnlinkedObligationCommand(id: unknown, input: unknown, client: SupabaseClient) {
  const { reason } = validateCancellation(input);
  return mapRpcResponse(await cancelUnlinkedObligation(client, validateUuid(id), reason));
}

export async function createUnlinkedObligationTemplateCommand(input: unknown, client: SupabaseClient) {
  return mapRpcResponse(await createUnlinkedObligationTemplate(client, validateCreateTemplate(input)));
}

export async function updateUnlinkedObligationTemplateCommand(id: unknown, input: unknown, client: SupabaseClient) {
  return mapRpcResponse(await updateUnlinkedObligationTemplate(client, validateUuid(id), validateUpdateTemplate(input)));
}

export async function generateUnlinkedObligationOccurrencesCommand(id: unknown, input: unknown, client: SupabaseClient) {
  const { throughDate } = validateGeneration(input);
  return mapRpcResponse(await generateUnlinkedObligationOccurrences(client, validateUuid(id), throughDate));
}
