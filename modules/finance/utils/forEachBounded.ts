/** Drain all started work before returning, including on abort/failure. No retries. */
export async function forEachBounded<T>(items: readonly T[], concurrency: number,
  process: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("INVALID_CONCURRENCY");
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      try {
        signal?.throwIfAborted();
        const item = items[next++];
        await process(item);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
  signal?.throwIfAborted();
}
