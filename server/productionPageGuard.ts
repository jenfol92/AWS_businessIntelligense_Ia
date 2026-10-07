import { notFound } from "next/navigation";
import { isModuleExposed, type PageModule } from "@/config/productionExposure";

/** Server-component gate; independent of cookies, browser JavaScript and middleware matcher. */
export function requireExposedPageModule(module: PageModule): void {
  if (!isModuleExposed(module)) notFound();
}
