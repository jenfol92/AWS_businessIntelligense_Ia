import { coordinateFbmSync } from "./fbmSyncCoordinator";
import { fbmRecoveryEnabled } from "./fbmSyncPolicy";

/** Recovery never creates a new report generation; it advances the durable owner. */
export async function recoverPendingFbmSync() {
  if (!fbmRecoveryEnabled()) return null;
  return coordinateFbmSync({ recoveryOnly: true });
}
