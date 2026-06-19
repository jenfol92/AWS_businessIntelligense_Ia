// modules/imports/amazon-sales/parser.ts

import Papa from "papaparse";

export async function parseAmazonSalesCsv(file: File) {
  const text = await file.text();

  return new Promise<any[]>((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: result => resolve(result.data),
      error: reject,
    });
  });
}