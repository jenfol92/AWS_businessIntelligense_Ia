import { requireExposedPageModule } from "@/server/productionPageGuard";

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("amazonCompliance");
  return children;
}
