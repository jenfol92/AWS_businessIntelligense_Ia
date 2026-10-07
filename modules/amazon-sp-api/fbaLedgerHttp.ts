import { ledgerHttpStatus,ledgerEnabled,ledgerDate } from "./fbaLedgerSyncPolicy.ts";
import type { ledgerResult } from "./fbaLedgerSyncCoordinator.ts";
type Result=ReturnType<typeof ledgerResult>;
export type LedgerHttpDependencies={authenticated():Promise<boolean>;observe(jobId?:string):Promise<Result|null>;enqueue(date?:string):Promise<Result|null>;enabled():boolean};
/** GET is observational by construction; no coordinator dependency is passed to it. */
export async function handleLedgerRequest(request:Request,deps:LedgerHttpDependencies) {
  if(!await deps.authenticated()) return Response.json({error:"No autenticado."},{status:401});
  try {
    if(request.method==="GET") {
      const id=new URL(request.url).searchParams.get("jobId")??undefined;
      if(id && !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({error:"jobId inválido."},{status:400});
      const result=await deps.observe(id);
      return Response.json({enabled:deps.enabled(),...(result??{status:"IDLE"})},{status:200});
    }
    if(!deps.enabled()) return Response.json({error:"Ledger pendiente de habilitación tras revisar la migración."},{status:503});
    const body=await request.json();
    if(body.action && !["request","start"].includes(body.action)) return Response.json({error:"El servidor recupera el trabajo; usa GET para consultar."},{status:400});
    if(body.marketplaceIds || body.fromDate && body.toDate!==body.fromDate) return Response.json({error:"Scope fijo COUNTRY/DAILY; un solo día."},{status:400});
    const date=ledgerDate(body.date??body.fromDate);
    const result=await deps.enqueue(date);
    return Response.json(result,{status:result?ledgerHttpStatus(result.status):404});
  } catch {return Response.json({error:"No se pudo procesar Ledger. Consulta el estado persistido."},{status:400});}
}
export {ledgerEnabled};
