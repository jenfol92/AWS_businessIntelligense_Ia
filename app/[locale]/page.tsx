import DashboardBI from "@/modules/dashboard/components/DashboardBI";
import DashboardShell from "@/shared/layout/DashboardShell";
import { GlobalFiltersProvider } from "@/shared/filters/GlobalFiltersProvider";

export default function LocaleIndexPage() {
  return (
    <GlobalFiltersProvider>
      <DashboardShell>
        <DashboardBI />
      </DashboardShell>
    </GlobalFiltersProvider>
  );
}

