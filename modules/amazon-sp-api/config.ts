export type SpApiRegion = "EU" | "NA" | "FE";

export type SpApiConfig = {
  region: SpApiRegion;
  endpoint: string;
  lwaClientId: string;
  lwaClientSecret: string;
  lwaRefreshToken: string;
  marketplaceIds: string[];
  /** Legacy opt-in: AWS SigV4 (no requerido desde oct-2023 para apps actuales). */
  useAwsSigV4: boolean;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRoleArn?: string;
};

const REQUIRED_ENV_KEYS = [
  "AMAZON_LWA_CLIENT_ID",
  "AMAZON_LWA_CLIENT_SECRET",
  "AMAZON_LWA_REFRESH_TOKEN",
] as const;

export function getMissingSpApiEnvKeys(): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] ?? "").trim());
}

function isTruthyEnv(value: string | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** AWS SigV4 solo si se activa explícitamente y hay credenciales completas (legacy). */
export function isAwsSigV4Configured(config: SpApiConfig): boolean {
  if (!config.useAwsSigV4) return false;
  return Boolean(
    config.awsAccessKeyId &&
      config.awsSecretAccessKey &&
      config.awsRoleArn &&
      config.awsRegion,
  );
}

export function loadSpApiConfig(): SpApiConfig {
  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    throw new Error(
      `Faltan credenciales SP-API. Revisa .env.local. (${missing.join(", ")})`,
    );
  }

  const region = (process.env.AMAZON_SP_API_REGION?.trim().toUpperCase() ||
    "EU") as SpApiRegion;

  const endpoint =
    process.env.AMAZON_SP_API_ENDPOINT?.trim() ||
    "https://sellingpartnerapi-eu.amazon.com";

  const marketplaceIds = [
    process.env.AMAZON_MARKETPLACE_ES,
    process.env.AMAZON_MARKETPLACE_FR,
    process.env.AMAZON_MARKETPLACE_DE,
    process.env.AMAZON_MARKETPLACE_IT,
    process.env.AMAZON_MARKETPLACE_GB,
    process.env.AMAZON_MARKETPLACE_PL,
    process.env.AMAZON_MARKETPLACE_SE,
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  if (marketplaceIds.length === 0) {
    throw new Error(
      "Faltan credenciales SP-API. Revisa .env.local. (AMAZON_MARKETPLACE_*)",
    );
  }

  const useAwsSigV4 = isTruthyEnv(process.env.AMAZON_SP_API_USE_AWS_SIGV4);
  const awsRegion = process.env.AMAZON_AWS_REGION?.trim() || undefined;
  const awsAccessKeyId = process.env.AMAZON_AWS_ACCESS_KEY_ID?.trim() || undefined;
  const awsSecretAccessKey =
    process.env.AMAZON_AWS_SECRET_ACCESS_KEY?.trim() || undefined;
  const awsRoleArn = process.env.AMAZON_AWS_ROLE_ARN?.trim() || undefined;

  if (useAwsSigV4 && (!awsAccessKeyId || !awsSecretAccessKey || !awsRoleArn)) {
    throw new Error(
      "AMAZON_SP_API_USE_AWS_SIGV4=true requiere AMAZON_AWS_ACCESS_KEY_ID, AMAZON_AWS_SECRET_ACCESS_KEY y AMAZON_AWS_ROLE_ARN.",
    );
  }

  return {
    region,
    endpoint: endpoint.replace(/\/$/, ""),
    lwaClientId: process.env.AMAZON_LWA_CLIENT_ID!.trim(),
    lwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET!.trim(),
    lwaRefreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN!.trim(),
    marketplaceIds,
    useAwsSigV4,
    awsRegion:
      awsRegion ||
      (region === "EU" ? "eu-west-1" : region === "FE" ? "us-west-2" : "us-east-1"),
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRoleArn,
  };
}

export const FBA_COUNTRY_REPORT_TYPE = "GET_AFN_INVENTORY_DATA_BY_COUNTRY";

export const DEFAULT_EU_MARKETPLACE_IDS = [
  "A1RKKUPIHCS9HS",
  "A13V1IB3VIYZZH",
  "A1PA6795UKMFR9",
  "APJ6JRA9NG5V4",
  "A1F83G8C2ARO7P",
  "A1C3SOZRARQ6R3",
  "A2NODRKZP88ZB9",
];
