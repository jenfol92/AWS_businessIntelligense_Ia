export async function paginateFinances(fetchPage, readItems, readNextToken) {
  const rows=[];
  let nextToken;
  do {
    const page=await fetchPage(nextToken);
    rows.push(...readItems(page));
    nextToken=readNextToken(page)||undefined;
  } while(nextToken);
  return rows;
}
