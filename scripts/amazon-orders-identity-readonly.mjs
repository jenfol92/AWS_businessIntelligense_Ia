// Explicit READ ONLY replay. Never imports reportsClient or the sync runtime.
import nextEnv from '@next/env';
import pg from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolveSalesAmazonIdentity } from '../modules/amazon-sp-api/amazonInventoryIdentityResolver.ts';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const { buildSalesIdentityEvidence } = await import('../modules/amazon-sp-api/operationalAmazonIdentityRepository.ts');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000});
await c.connect();
try {
 await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const products=(await c.query('select id,sku,asin,nombre from productos')).rows;
 const ledger=(await c.query('select distinct producto_id,sku_original,msku_aliases,asin from amazon_fba_inventory_ledger_daily where producto_id is not null')).rows;
 const logistics=(await c.query('select producto_id,ean_upc from producto_logistica')).rows;
 const rows=(await c.query('select id,producto_id,seller_sku,asin,quantity,fulfillment_channel,purchase_date::text,order_status from amazon_order_items order by id')).rows;
 const observedMarketplaces=(await c.query('select marketplace_country,sales_channel,count(*) lines,sum(quantity) units from amazon_order_items group by marketplace_country,sales_channel order by marketplace_country,sales_channel')).rows;
 const sharedEans=(await c.query("select trim(ean_upc) ean,count(distinct producto_id) products from producto_logistica where nullif(trim(ean_upc),'') is not null group by trim(ean_upc) having count(distinct producto_id)>1 order by trim(ean_upc)")).rows;
 const hash=(await c.query("select md5(string_agg(md5(to_jsonb(t)::text),',' order by id)) hash from amazon_order_items t")).rows[0].hash;
 const master=products.filter(p=>['BUBBLY - GRIS','BUBBLY - VERDE','SAMI - GRIS','SAMI - ROSA','SAMI - MENTA'].includes(p.nombre)).map(p=>({...p,ean:logistics.filter(l=>l.producto_id===p.id).map(l=>l.ean_upc)}));
 const evidence=buildSalesIdentityEvidence(products,ledger,logistics),byId=new Map(products.map(p=>[p.id,p]));
 const summary={},nullGroups=new Map(),changedKnown=[],blockedKnown=[],recovered=[];
 const channelsBefore={FBA:0,FBM:0},channelsAfter={FBA:0,FBM:0};
 const outcomes=[];
 for(const row of rows){
  const r=resolveSalesAmazonIdentity(row.seller_sku,row.asin,evidence);outcomes.push({row,result:r});
  channelsBefore[row.fulfillment_channel]=(channelsBefore[row.fulfillment_channel]??0)+row.quantity;
  channelsAfter[row.fulfillment_channel]=(channelsAfter[row.fulfillment_channel]??0)+row.quantity;
  if(row.producto_id){if(r.productoId&&r.productoId!==row.producto_id)changedKnown.push({row,result:r});if(!r.productoId)blockedKnown.push({row,result:r});continue;}
  const key=row.seller_sku+'\0'+row.asin+'\0'+r.status;
  const g=nullGroups.get(key)??{seller_sku:row.seller_sku,asin:row.asin,status:r.status,producto_id:r.productoId,nombre:byId.get(r.productoId)?.nombre??null,evidence:r.evidence,lines:0,units:0,FBA:0,FBM:0};
  g.lines++;g.units+=row.quantity;g[row.fulfillment_channel]=(g[row.fulfillment_channel]??0)+row.quantity;nullGroups.set(key,g);
  const s=summary[r.status]??{lines:0,units:0,skus:new Set()};s.lines++;s.units+=row.quantity;s.skus.add(row.seller_sku);summary[r.status]=s;
  if(r.productoId)recovered.push({row,result:r});
 }
 const missing=rows.filter(r=>!r.producto_id),units=missing.reduce((n,r)=>n+r.quantity,0);
 for(const v of Object.values(summary)){v.skus=v.skus.size;v.percent=100*v.units/units;}
 const totals={};for(const label of ['ACCOUNT','CURRENT','AFTER_ASIN','AFTER_ASIN_SKU','UNRESOLVED'])totals[label]={FBA:0,FBM:0,TOTAL:0};
 for(const {row,result} of outcomes){if(row.purchase_date<'2026-07-02'||row.purchase_date>'2026-08-11')continue;if(/cancel/i.test(row.order_status))continue;
  const add=label=>{totals[label][row.fulfillment_channel]=(totals[label][row.fulfillment_channel]??0)+row.quantity;totals[label].TOTAL+=row.quantity;};
  add('ACCOUNT');if(row.producto_id)add('CURRENT');
  const afterAsin=Boolean(row.producto_id||result.status==='SAFE_BY_ASIN');const afterAll=Boolean(row.producto_id||result.productoId);
  if(afterAsin)add('AFTER_ASIN');if(afterAll)add('AFTER_ASIN_SKU');else add('UNRESOLVED');
 }
 const suspects=(await c.query("select id,sku,producto_id,asin,matched_by from amazon_envios where (sku='f8436616610364' and producto_id='e84b049b-0c0b-4a94-88e2-e23e1e3382a8') or (sku='f8436616610326' and producto_id='5882751e-894e-4525-a1c3-99f0b194c99c') order by id")).rows.map(r=>({...r,classification:'HISTORICAL_IDENTITY_MAPPING_SUSPECT'}));
 const hashAfter=(await c.query("select md5(string_agg(md5(to_jsonb(t)::text),',' order by id)) hash from amazon_order_items t")).rows[0].hash;
 await c.query('COMMIT');
 const result={observedMarketplaces,sharedEans,checkedAt:new Date().toISOString(),universe:{lines:rows.length,units:rows.reduce((n,r)=>n+r.quantity,0),nullLines:missing.length,nullUnits:units,nullSkus:new Set(missing.map(r=>r.seller_sku)).size,nullAsins:new Set(missing.map(r=>r.asin)).size},master,summary,changedKnown,blockedKnown,groups:Array.from(nullGroups.values()),recovered,totals,channelsBefore,channelsAfter,alaia:outcomes.filter(o=>o.row.seller_sku==='8436616610104'||o.row.seller_sku==='f8436616610104').map(o=>({id:o.row.id,before:o.row.producto_id,after:o.result.productoId,status:o.result.status})),suspects,readOnlyHashUnchanged:hash===hashAfter};
 await mkdir('outputs/amazon-orders-phase1',{recursive:true});await writeFile('outputs/amazon-orders-phase1/read-only-replay.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({checkedAt:result.checkedAt,universe:result.universe,master,summary,knownChanged:changedKnown.length,knownBlocked:blockedKnown.length,recovered,totals,channelsBefore,channelsAfter,alaiaRows:result.alaia.length,alaiaIdentityChanged:result.alaia.filter(r=>r.before!==r.after).length,suspectHistoricalMappings:suspects.length,readOnlyHashUnchanged:result.readOnlyHashUnchanged},null,2));
}finally{await c.end()}
