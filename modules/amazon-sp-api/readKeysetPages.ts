export async function readKeysetPages<T>(
  fetchPage: (after: string | null, limit: number) => Promise<T[]>,
  options: { pageSize: number; cursorOf: (row: T) => string },
): Promise<T[]> {
  const { pageSize, cursorOf } = options;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid keyset page size");

  const all: T[] = [];
  let after: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await fetchPage(after, pageSize);
    if (page.length > pageSize) throw new Error("Keyset page exceeds requested size");
    if (!page.length) {
      hasMore = false;
      continue;
    }
    let previous = after;
    for (const row of page) {
      const cursor = cursorOf(row);
      if (!cursor || (previous !== null && cursor <= previous)) {
        throw new Error("Keyset cursor must increase strictly");
      }
      previous = cursor;
    }
    all.push(...page);
    after = previous;
    if (page.length < pageSize) hasMore = false;
  }
  return all;
}
