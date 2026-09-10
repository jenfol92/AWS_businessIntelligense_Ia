import { supabaseAdmin } from "@/server/supabase/adminClient";

export type AmazonSalesEvidenceRow={producto_id:string|null;sku_original:string;sku_limpio:string;asin:string;marketplace_country:string;fulfillment_channel:string;currency:string;quantity:number;item_price:number;item_tax:number;shipping_price:number;gift_wrap_price:number;purchase_date:string;order_status:string;item_status:string};
export async function readAmazonSalesEvidenceAdmin(dateFrom:string,dateTo:string):Promise<AmazonSalesEvidenceRow[]>{
  const rows:AmazonSalesEvidenceRow[]=[];for(let from=0;;from+=1000){const {data,error}=await supabaseAdmin.from("amazon_all_orders_items").select("producto_id,sku_original,sku_limpio,asin,marketplace_country,fulfillment_channel,currency,quantity,item_price,item_tax,shipping_price,gift_wrap_price,purchase_date,order_status,item_status").gte("purchase_date",dateFrom).lte("purchase_date",dateTo).gt("quantity",0).or("sku_limpio.like.843661661%,sku_original.like.*843661661*").order("purchase_date",{ascending:true}).range(from,from+999);if(error)throw new Error(error.message);const page=(data??[]) as AmazonSalesEvidenceRow[];rows.push(...page);if(page.length<1000)break;}return rows;
}
export async function readAmazonDailySalesFallbackAdmin(dateFrom:string,dateTo:string):Promise<AmazonSalesEvidenceRow[]>{
  const {data:products,error:productError}=await supabaseAdmin.from("productos").select("id,sku,asin").ilike("sku","%843661661%");if(productError)throw new Error(productError.message);const identities=new Map((products??[]).map(row=>[String(row.id),{sku:String(row.sku??""),asin:String(row.asin??"")}])) ;const ids=Array.from(identities.keys());if(!ids.length)return[];const rows:AmazonSalesEvidenceRow[]=[];
  for(let chunkStart=0;chunkStart<ids.length;chunkStart+=200){const chunk=ids.slice(chunkStart,chunkStart+200);for(let from=0;;from+=1000){const {data,error}=await supabaseAdmin.from("ventas_diarias").select("producto_id,fecha,pais,canal_venta,moneda,unidades_vendidas,ingresos_brutos").in("producto_id",chunk).gte("fecha",dateFrom).lte("fecha",dateTo).gt("unidades_vendidas",0).order("fecha",{ascending:true}).range(from,from+999);if(error)throw new Error(error.message);const page=data??[];for(const row of page){const item=identities.get(String(row.producto_id));if(!item)continue;rows.push({producto_id:String(row.producto_id),sku_original:item.sku,sku_limpio:item.sku,asin:item.asin,marketplace_country:String(row.pais??""),fulfillment_channel:String(row.canal_venta??""),currency:String(row.moneda??"EUR"),quantity:Number(row.unidades_vendidas??0),item_price:Number(row.ingresos_brutos??0),item_tax:0,shipping_price:0,gift_wrap_price:0,purchase_date:String(row.fecha),order_status:"daily_aggregate",item_status:"daily_aggregate"});}if(page.length<1000)break;}}
  return rows;
}
export async function readTargetPricesAdmin(productIds:string[]){
  if(!productIds.length)return new Map<string,number>();const {data,error}=await supabaseAdmin.from("producto_finanzas").select("producto_id,precio_venta_objetivo").in("producto_id",productIds);if(error)throw new Error(error.message);return new Map((data??[]).map(row=>[String(row.producto_id),Number(row.precio_venta_objetivo??0)]));
}
export async function readLatestFeePreviewContentAdmin(){
  const {data,error}=await supabaseAdmin.from("amazon_spapi_report_jobs").select("report_id,completed_at,raw").eq("report_type","GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA").not("report_id","is",null).order("completed_at",{ascending:false,nullsFirst:false}).limit(1).maybeSingle();if(error)throw new Error(error.message);const raw=data?.raw as Record<string,unknown>|null;return data&&typeof raw?.reportContent==="string"?{reportId:String(data.report_id),observedAt:String(data.completed_at),content:raw.reportContent}:null;
}

export type AmazonOperationalFbaStockRow={
  producto_id:string;
  stock_fba_pan_eu:number;
  stock_fba_uk:number;
  stock_fba_total:number;
  observed_at:string;
  dual_pool_complete:boolean;
};

export async function readLatestOperationalFbaStockAdmin(productIds:string[]):Promise<Map<string,AmazonOperationalFbaStockRow>>{
  if(!productIds.length)return new Map();
  const rows:AmazonOperationalFbaStockRow[]=[];
  for(let start=0;start<productIds.length;start+=200){
    const {data,error}=await supabaseAdmin
      .from("v_latest_amazon_fba_inventory_by_product_operational_total")
      .select("producto_id,stock_fba_pan_eu,stock_fba_uk,stock_fba_total,observed_at,dual_pool_complete")
      .in("producto_id",productIds.slice(start,start+200));
    if(error)throw new Error(error.message);
    for(const row of data??[]){
      rows.push({
        producto_id:String(row.producto_id),
        stock_fba_pan_eu:Number(row.stock_fba_pan_eu??0),
        stock_fba_uk:Number(row.stock_fba_uk??0),
        stock_fba_total:Number(row.stock_fba_total??0),
        observed_at:String(row.observed_at??""),
        dual_pool_complete:Boolean(row.dual_pool_complete),
      });
    }
  }
  return new Map(rows.map(row=>[row.producto_id,row]));
}
