export const FBA_FEE_PREVIEW_REPORT_TYPE="GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA" as const;
export type FbaFeePreviewRow={
  sku:string;fnsku:string;asin:string;amazonStore:string;currency:string;
  referralFeePerUnit:number;fulfillmentFeePerUnit:number;totalFeePerUnit:number;
  reportId:string;observedAt:string;source:"FBA_FEE_PREVIEW_REPORT";
};
function number(value:unknown){const parsed=Number(String(value??"").replace(",","."));return Number.isFinite(parsed)?parsed:0;}
function parseRows(content:string){const lines=content.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const delimiter=lines[0].includes("\t")?"\t":",";const headers=lines[0].split(delimiter).map(value=>value.trim().toLowerCase());return lines.slice(1).map(line=>Object.fromEntries(headers.map((header,index)=>[header,line.split(delimiter)[index]??""])));}
function field(row:Record<string,string>,name:string){return String(row[name]??"").trim();}
export function parseFbaFeePreview(content:string,meta:{reportId:string;observedAt:string}):FbaFeePreviewRow[]{
  return parseRows(content).map(row=>({
    sku:field(row,"sku"),fnsku:field(row,"fnsku"),asin:field(row,"asin"),amazonStore:field(row,"amazon-store"),
    currency:field(row,"currency"),referralFeePerUnit:number(field(row,"estimated-referral-fee-per-unit")),
    fulfillmentFeePerUnit:number(field(row,"expected-domestic-fulfilment-fee-per-unit")),
    totalFeePerUnit:number(field(row,"estimated-fee-total")),reportId:meta.reportId,observedAt:meta.observedAt,source:"FBA_FEE_PREVIEW_REPORT" as const,
  })).filter(row=>row.sku&&row.asin&&row.currency);
}
export function feePreviewBySku(rows:FbaFeePreviewRow[]){return new Map(rows.map(row=>[`${row.amazonStore}|${row.sku}`,row]));}
export function feePreviewByAsin(rows:FbaFeePreviewRow[]){return new Map(rows.map(row=>[`${row.amazonStore}|${row.asin}`,row]));}
