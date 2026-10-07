import { LedgerEvidenceError } from "./strictLedgerDocument.ts";

/** Page below PostgREST's 1000-row cap; callers MUST order by a unique key. */
export async function readLedgerPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = [];
  const size = 500;
  for (let offset = 0; offset < 250000; offset += size) {
    signal?.throwIfAborted();
    const result = await fetchPage(offset, offset + size - 1);
    if (result.error) throw new Error("LEDGER_LOOKUP_FAILED");
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < size) return rows;
  }
  throw new LedgerEvidenceError("LEDGER_LOOKUP_LIMIT");
}
