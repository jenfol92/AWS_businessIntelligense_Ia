import {recoverPendingLedgerSync} from "@/modules/amazon-sp-api/fbaLedgerSyncRecovery";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret)return Response.json({error:"CRON_SECRET no configurado."},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`)return Response.json({error:"No autorizado."},{status:401});
  try{return Response.json(await recoverPendingLedgerSync());}
  catch{return Response.json({error:"LEDGER_RECOVERY_FAILED"},{status:503});}
}
