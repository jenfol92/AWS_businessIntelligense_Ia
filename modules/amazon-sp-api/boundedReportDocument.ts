import { gunzipSync } from "node:zlib";
import type { SpApiReportDocument } from "./types";

export type ReportDownloadOptions = { signal: AbortSignal; maxBytes: number; fetchDocument?: typeof fetch };

/** In-memory bounded download. No auth headers, redirects, persistence or error payloads. */
export async function downloadBoundedReportDocument(document: SpApiReportDocument, options: ReportDownloadOptions): Promise<string> {
  options.signal.throwIfAborted();
  const url = new URL(document.url);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !/\.(amazonaws\.com|cloudfront\.net)$/.test(url.hostname)) throw new Error("INVALID_DOCUMENT_URL");
  if (document.compressionAlgorithm !== undefined && document.compressionAlgorithm !== "GZIP") throw new Error("UNSUPPORTED_COMPRESSION");
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("INVALID_BYTE_LIMIT");
  const res = await (options.fetchDocument ?? fetch)(url.href, { method: "GET", redirect: "error", credentials: "omit", signal: options.signal });
  if (!res.ok || !res.body) throw new Error("DOCUMENT_HTTP_ERROR");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      options.signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > options.maxBytes) throw new Error("DOCUMENT_TOO_LARGE");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const data = Buffer.concat(chunks);
  const decoded = document.compressionAlgorithm === "GZIP" ? gunzipSync(data, { maxOutputLength: options.maxBytes }) : data;
  options.signal.throwIfAborted();
  const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  return new TextDecoder(charset, { fatal: true }).decode(decoded);
}
