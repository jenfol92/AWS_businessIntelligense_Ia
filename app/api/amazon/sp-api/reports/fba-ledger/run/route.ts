import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { handleLedgerRequest,ledgerEnabled } from "@/modules/amazon-sp-api/fbaLedgerHttp";
import { observeLedgerJob } from "@/modules/amazon-sp-api/fbaLedgerSyncRepository";
import { coordinateLedgerSync,ledgerResult } from "@/modules/amazon-sp-api/fbaLedgerSyncCoordinator";
export const dynamic="force-dynamic";
const dependencies={
 authenticated:async()=>!!(await createSupabaseRouteClient().auth.getUser()).data.user,
 enabled:ledgerEnabled,
 observe:async(id?:string)=>{const job=await observeLedgerJob(id);return job?ledgerResult(job):null;},
 enqueue:(date?:string)=>coordinateLedgerSync({date,enqueueOnly:true}),
};
export const GET=(request:Request)=>handleLedgerRequest(request,dependencies);
export const POST=(request:Request)=>handleLedgerRequest(request,dependencies);
