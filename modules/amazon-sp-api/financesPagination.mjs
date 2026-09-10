export async function paginateFinances(fetchPage, readItems, readNextToken) {
  const rows=[];
  let nextToken;
  const seen = new Set();
  let pages = 0;
  do {
    if (++pages > 100) throw new Error("FINANCES_PAGE_LIMIT: incomplete result");
    const page=await fetchPage(nextToken);
    rows.push(...readItems(page));
    nextToken=readNextToken(page)||undefined;
    if (nextToken && seen.has(nextToken)) throw new Error("FINANCES_REPEATED_TOKEN: incomplete result");
    if (nextToken) seen.add(nextToken);
  } while(nextToken);
  return rows;
}
