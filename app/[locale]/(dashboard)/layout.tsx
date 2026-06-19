import DashboardShell from "@/shared/layout/DashboardShell";
import { GlobalFiltersProvider } from "@/shared/filters/GlobalFiltersProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GlobalFiltersProvider>
      <DashboardShell>{children}</DashboardShell>
    </GlobalFiltersProvider>
  );
}
