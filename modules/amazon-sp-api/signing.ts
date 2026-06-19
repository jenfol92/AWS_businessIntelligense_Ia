/**
 * Legacy AWS Signature V4 para SP-API.
 * No es necesario para aplicaciones actuales desde octubre 2023.
 * Solo se usa si AMAZON_SP_API_USE_AWS_SIGV4=true y hay credenciales IAM completas.
 */
import { Sha256 } from "@aws-crypto/sha256-js";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import type { SpApiConfig } from "./config";

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
};

let cachedAwsCredentials: AwsCredentials | null = null;

export function clearAwsCredentialsCache(): void {
  cachedAwsCredentials = null;
}

async function assumeSpApiRole(config: SpApiConfig): Promise<AwsCredentials> {
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey || !config.awsRoleArn) {
    throw new Error(
      "Credenciales AWS incompletas para SigV4 legacy. Desactiva AMAZON_SP_API_USE_AWS_SIGV4 o completa las variables.",
    );
  }

  const now = new Date();
  if (
    cachedAwsCredentials &&
    cachedAwsCredentials.expiration.getTime() > now.getTime() + 60_000
  ) {
    return cachedAwsCredentials;
  }

  const sts = new STSClient({
    region: config.awsRegion ?? "eu-west-1",
    credentials: {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
  });

  const result = await sts.send(
    new AssumeRoleCommand({
      RoleArn: config.awsRoleArn,
      RoleSessionName: "erp-sp-api-session",
      DurationSeconds: 3600,
    }),
  );

  const creds = result.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error("No se pudieron obtener credenciales temporales AWS (STS).");
  }

  cachedAwsCredentials = {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    expiration: creds.Expiration ?? new Date(now.getTime() + 3600_000),
  };

  return cachedAwsCredentials;
}

export type SignSpApiRequestInput = {
  config: SpApiConfig;
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  accessToken: string;
};

export async function signSpApiRequest(input: SignSpApiRequestInput) {
  const credentials = await assumeSpApiRole(input.config);
  const endpointUrl = new URL(input.config.endpoint);
  const queryEntries = Object.entries(input.query ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );

  const bodyString =
    input.body == null
      ? undefined
      : typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body);

  const headers: Record<string, string> = {
    host: endpointUrl.host,
    "x-amz-access-token": input.accessToken,
  };

  if (bodyString != null) {
    headers["content-type"] = "application/json";
  }

  const request = new HttpRequest({
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: input.path,
    method: input.method.toUpperCase(),
    headers,
    query: Object.fromEntries(queryEntries),
    body: bodyString,
  });

  const signer = new SignatureV4({
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    region: input.config.awsRegion ?? "eu-west-1",
    service: "execute-api",
    sha256: Sha256,
  });

  return signer.sign(request);
}
