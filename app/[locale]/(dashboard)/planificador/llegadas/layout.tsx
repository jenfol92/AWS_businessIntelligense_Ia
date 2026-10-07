import { requireExposedPageModule } from "@/server/productionPageGuard";

export default function ArrivalsLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("arrivals");
  return children;
}
