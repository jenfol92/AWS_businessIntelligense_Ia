import { requireExposedPageModule } from "@/server/productionPageGuard";
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("planner");
  return children;
}
