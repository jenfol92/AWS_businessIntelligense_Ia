"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import { ledgerUiState } from "../services/ledgerSyncUi";
type State={jobId?:string;status:string;phase?:string;publishedAt?:string;enabled?:boolean;error?:string};
const endpoint="/api/amazon/sp-api/reports/fba-ledger/run";
export function LedgerSyncButton({onCompleted}:{onCompleted:()=>void}) {
  const [state,setState]=useState<State>({status:"IDLE"});
  const [sending,setSending]=useState(false);
  const completed=useRef<string>();
  const callback=useRef(onCompleted);callback.current=onCompleted;
  const observe=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(endpoint,{cache:"no-store",signal});
    if(!response.ok) throw new Error("No se pudo consultar Ledger.");
    const result:State=await response.json();setState(result);
    if(result.status==="COMPLETED" && result.jobId && completed.current!==result.jobId) {
      completed.current=result.jobId;callback.current();
    }
  },[]);
  useEffect(()=>{
    const controller=new AbortController();let active=false;
    const tick=async()=>{if(active)return;active=true;try{await observe(controller.signal);}catch{if(!controller.signal.aborted)setState(s=>({...s,error:"No se pudo consultar el estado."}));}finally{active=false;}};
    void tick();const timer=setInterval(()=>void tick(),15000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[observe]);
  const start=async()=>{
    setSending(true);
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??"No se pudo iniciar Ledger.");
      setState(result);
    }catch(error){setState(s=>({...s,error:error instanceof Error?error.message:"Error Ledger"}));}
    finally{setSending(false);}
  };
  const ui=ledgerUiState(state);
  return <div className="flex flex-col gap-1">
    <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
      disabled={sending || ui.pending || state.enabled===false} onClick={()=>void start()}>Actualizar stock por país</button>
    <span className="text-xs text-slate-500" role="status">{state.error??ui.label}</span>
  </div>;
}
