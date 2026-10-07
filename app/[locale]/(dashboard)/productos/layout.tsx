import { requireExposedPageModule } from "@/server/productionPageGuard";
export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("products");
  return children;
}
