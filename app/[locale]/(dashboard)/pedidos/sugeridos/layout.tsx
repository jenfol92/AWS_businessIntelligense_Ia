import { requireExposedPageModule } from "@/server/productionPageGuard";
export default function PurchaseSuggestionsLayout({ children }: { children: React.ReactNode }) {
  requireExposedPageModule("purchaseSuggestions");
  return children;
}
