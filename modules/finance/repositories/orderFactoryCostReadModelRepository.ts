import {createSupabaseRouteClient} from "@/server/supabase/routeClient";
import {buildOrderFactoryCostReadModel} from "../services/buildOrderFactoryCostReadModel";

export async function findOrderFactoryCostReadModel(orderId:string){
  const client=createSupabaseRouteClient();
  const [itemsResult,paymentsResult]=await Promise.all([
    client.from("orden_items").select("id,cantidad,coste_unitario_moneda").eq("orden_id",orderId),
    client.from("finance_supplier_payments").select(`id,amount_original,original_currency,planned_fx_foreign_per_eur,finance_purchase_payment_allocations(id,batch_id,allocated_amount_original,allocated_amount_eur,finance_purchase_payment_batches!inner(status))`).eq("orden_id",orderId).neq("status","anulado"),
  ]);
  if(itemsResult.error) throw new Error(itemsResult.error.message);if(paymentsResult.error) throw new Error(paymentsResult.error.message);
  return buildOrderFactoryCostReadModel({orderId,lines:(itemsResult.data??[]).map(row=>({id:String(row.id),quantity:Number(row.cantidad),unitOriginal:Number(row.coste_unitario_moneda)})),obligations:(paymentsResult.data??[]).map(payment=>({id:String(payment.id),amountOriginal:Number(payment.amount_original),currency:String(payment.original_currency),plannedFxForeignPerEur:payment.planned_fx_foreign_per_eur==null?null:Number(payment.planned_fx_foreign_per_eur),allocations:((payment.finance_purchase_payment_allocations??[]) as unknown as Array<Record<string,unknown>>).filter(row=>{const batch=Array.isArray(row.finance_purchase_payment_batches)?row.finance_purchase_payment_batches[0]:row.finance_purchase_payment_batches;return (batch as Record<string,unknown>|null)?.status!=="reversed";}).map(row=>({id:String(row.id),obligationId:String(payment.id),batchId:String(row.batch_id),amountOriginal:Number(row.allocated_amount_original),amountEur:Number(row.allocated_amount_eur)}))}))});
}
