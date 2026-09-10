export const AMAZON_OBSERVATION_SCHEMA_MESSAGE =
  "La base de datos no tiene la versión de observaciones Amazon requerida. Debe revisarse la migración 20260812_02_amazon_marketplace_external_fx_ecb.sql antes de actualizar.";

export class AmazonObservationSchemaError extends Error {
  readonly code = "AMAZON_OBSERVATION_SCHEMA_MISMATCH";
  constructor() { super(AMAZON_OBSERVATION_SCHEMA_MESSAGE); }
}

export function assertAmazonObservationSchemaError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (["PGRST202", "PGRST204", "42703", "42883"].includes(error.code ?? ""))
    throw new AmazonObservationSchemaError();
  throw new Error(error.message);
}
