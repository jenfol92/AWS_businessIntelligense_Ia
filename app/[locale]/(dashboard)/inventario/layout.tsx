import { requireExposedPageModule } from "@/server/productionPageGuard";
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("inventory");
  return children;
}
