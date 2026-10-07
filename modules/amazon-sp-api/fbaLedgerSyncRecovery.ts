import { coordinateLedgerSync } from "./fbaLedgerSyncCoordinator";
import { ledgerEnabled,ledgerScheduleEnabled } from "./fbaLedgerSyncPolicy";

/** Same worker for any scheduler/process. At most ONE Amazon phase per invocation. */
export async function recoverPendingLedgerSync() {
  if(!ledgerEnabled()) return {status:"DISABLED"};
  if(ledgerScheduleEnabled()) await coordinateLedgerSync({enqueueOnly:true});
  return await coordinateLedgerSync({recoveryOnly:true}) ?? {status:"IDLE"};
}
