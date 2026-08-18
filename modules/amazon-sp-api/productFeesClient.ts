export type ProductFeesMoney = { CurrencyCode: string; Amount: number };
export type ProductFeesInput = {
  identifier: string;
  marketplaceId: string;
  idType: "SellerSKU" | "ASIN";
  idValue: string;
  listingPrice: ProductFeesMoney;
  shipping?: ProductFeesMoney;
  isAmazonFulfilled: boolean;
};
export type ProductFeeDetail = {
  FeeType?: string;
  FeeAmount?: ProductFeesMoney;
  FinalFee?: ProductFeesMoney;
  FeePromotion?: ProductFeesMoney;
  IncludedFeeDetailList?: ProductFeeDetail[];
};
export type ProductFeesEstimate = {
  status: string;
  identifier: string;
  marketplaceId: string;
  idType: ProductFeesInput["idType"];
  idValue: string;
  currency: string;
  estimatedAt: string;
  referralFeePerUnit: number;
  fulfillmentFeePerUnit: number;
  otherFeePerUnit: number;
  totalFeePerUnit: number;
  promotionalFinalFeePerUnit: number | null;
  hasTemporaryPromotion: boolean;
  source: "PRODUCT_FEES_API";
  raw: unknown;
};

type Request = <T>(input:{method:"GET"|"POST"|"PUT"|"DELETE";path:string;query?:Record<string,string|undefined>;body?:unknown})=>Promise<T>;
const defaultRequest:Request=async input=>(await import("./spApiClient")).spApiRequest(input);
type CacheEntry = { expiresAt: number; value: ProductFeesEstimate };
const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function round(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function amount(value: ProductFeesMoney | undefined) {
  const n = Number(value?.Amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function buildRequest(input: ProductFeesInput) {
  const zero = { CurrencyCode: input.listingPrice.CurrencyCode, Amount: 0 };
  return {
    MarketplaceId: input.marketplaceId,
    IsAmazonFulfilled: input.isAmazonFulfilled,
    PriceToEstimateFees: {
      ListingPrice: input.listingPrice,
      Shipping: input.shipping ?? zero,
      Points: { PointsNumber: 0, PointsMonetaryValue: zero },
    },
    Identifier: input.identifier,
  };
}
function cacheKey(input: ProductFeesInput) {
  return [input.marketplaceId,input.idType,input.idValue,input.listingPrice.CurrencyCode,input.listingPrice.Amount,input.shipping?.Amount ?? 0,input.isAmazonFulfilled].join("|");
}
function findFee(details: ProductFeeDetail[], type: string) {
  return details.find(detail => detail.FeeType === type);
}
function parseEstimate(input: ProductFeesInput, raw: any): ProductFeesEstimate {
  const result = raw?.payload?.FeesEstimateResult ?? raw?.FeesEstimateResult ?? raw;
  if (result?.Status !== "Success" || !result?.FeesEstimate) {
    throw new Error(`PRODUCT_FEES_ESTIMATE_${String(result?.Status ?? "INVALID")}`);
  }
  const estimate = result.FeesEstimate;
  const details = (estimate.FeeDetailList ?? []) as ProductFeeDetail[];
  const referral = amount(findFee(details,"ReferralFee")?.FeeAmount);
  const fulfillment = amount(findFee(details,"FBAFees")?.FeeAmount);
  const standardTotal = details.reduce((sum, detail) => sum + amount(detail.FeeAmount), 0);
  const promotionalTotal = details.reduce((sum, detail) => sum + amount(detail.FinalFee), 0);
  const other = Math.max(0, standardTotal - referral - fulfillment);
  const hasTemporaryPromotion = details.some(detail => amount(detail.FeePromotion) !== 0);
  return {
    status: result.Status,
    identifier: input.identifier,
    marketplaceId: input.marketplaceId,
    idType: input.idType,
    idValue: input.idValue,
    currency: input.listingPrice.CurrencyCode,
    estimatedAt: String(estimate.TimeOfFeesEstimation ?? new Date().toISOString()),
    referralFeePerUnit: round(referral),
    fulfillmentFeePerUnit: round(fulfillment),
    otherFeePerUnit: round(other),
    totalFeePerUnit: round(standardTotal),
    promotionalFinalFeePerUnit: hasTemporaryPromotion ? round(promotionalTotal) : null,
    hasTemporaryPromotion,
    source: "PRODUCT_FEES_API",
    raw,
  };
}
async function withRetry<T>(work:()=>Promise<T>, attempts=3):Promise<T>{
  let last:unknown;
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await work();}catch(error){last=error;if(attempt+1>=attempts)break;await new Promise(resolve=>setTimeout(resolve,Math.min(2000,250*2**attempt)));}
  }
  throw last;
}

export function createProductFeesClient(request:Request=defaultRequest,options:{ttlMs?:number;now?:()=>number}={}){
  const now=options.now??Date.now,ttlMs=options.ttlMs??DEFAULT_TTL_MS;
  async function one(input:ProductFeesInput){
    const key=cacheKey(input),cached=cache.get(key);if(cached&&cached.expiresAt>now())return cached.value;
    const path=input.idType==="SellerSKU"?`/products/fees/v0/listings/${encodeURIComponent(input.idValue)}/feesEstimate`:`/products/fees/v0/items/${encodeURIComponent(input.idValue)}/feesEstimate`;
    const raw=await withRetry(()=>request<any>({method:"POST",path,body:{FeesEstimateRequest:buildRequest(input)}}));
    const value=parseEstimate(input,raw);cache.set(key,{expiresAt:now()+ttlMs,value});return value;
  }
  return {
    getMyFeesEstimateForSKU:(input:Omit<ProductFeesInput,"idType">)=>one({...input,idType:"SellerSKU"}),
    getMyFeesEstimateForASIN:(input:Omit<ProductFeesInput,"idType">)=>one({...input,idType:"ASIN"}),
    async getMyFeesEstimates(inputs:ProductFeesInput[]){
      if(inputs.length<1||inputs.length>20)throw new Error("PRODUCT_FEES_BATCH_SIZE");
      const missing:ProductFeesInput[]=[];const values=new Map<string,ProductFeesEstimate>();
      for(const input of inputs){const cached=cache.get(cacheKey(input));if(cached&&cached.expiresAt>now())values.set(input.identifier,cached.value);else missing.push(input);}
      if(missing.length){
        const body=missing.map(input=>({IdType:input.idType,IdValue:input.idValue,...buildRequest(input)}));
        const raw=await withRetry(()=>request<any>({method:"POST",path:"/products/fees/v0/feesEstimate",body}));
        const rows=Array.isArray(raw)?raw:Array.isArray(raw?.payload)?raw.payload:[];
        for(let index=0;index<missing.length;index++){const input=missing[index];const value=parseEstimate(input,rows[index]);cache.set(cacheKey(input),{expiresAt:now()+ttlMs,value});values.set(input.identifier,value);}
      }
      return inputs.map(input=>values.get(input.identifier)!);
    },
  };
}

export const productFeesClient=createProductFeesClient();
export function resetProductFeesCacheForTests(){cache.clear();}
