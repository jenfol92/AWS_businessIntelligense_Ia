export function ledgerUiState(state:{status:string;phase?:string;publishedAt?:string;enabled?:boolean}) {
  const pending=["PENDING","PROCESSING","RATE_LIMITED"].includes(state.status);
  const label=state.enabled===false?"Pendiente de habilitación":state.status==="COMPLETED"
    ?`Actualizado: ${state.publishedAt??"fecha no disponible"}`
    :pending ? state.phase==="CREATE"?"Trabajo iniciado; el servidor continuará":state.phase==="POLL"?"Amazon procesando; el servidor continuará":"Validando y publicando"
    :state.status==="CREATE_UNCERTAIN"?"Creación pendiente de conciliación; no se repetirá automáticamente"
    :["FAILED","FATAL","CANCELLED"].includes(state.status)?"Trabajo detenido; requiere revisión":"Evidencia física al cierre del día";
  return {pending,label};
}
