"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "@/shared/layout/Sidebar";
import GlobalFiltersBar from "@/shared/layout/GlobalFiltersBar";
import UserHeaderInfo from "@/shared/layout/UserHeaderInfo";
import { Menu } from "lucide-react";

type DashboardShellProps = {
  children: React.ReactNode;
};

/** Shell responsive del dashboard: sidebar fija en desktop y drawer en móvil/tablet. */
export default function DashboardShell({ children }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen, closeMobile]);

  return (
    <div className="min-h-screen bg-slate-50">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-[1px] lg:hidden"
          aria-label="Cerrar menú de navegación"
          onClick={closeMobile}
        />
      ) : null}

      <Sidebar mobileOpen={mobileOpen} onNavigate={closeMobile} onClose={closeMobile} />

      <main className="min-h-screen px-4 py-5 sm:px-6 lg:ml-64 lg:px-8 lg:py-8">
        <header className="mb-6 flex flex-col gap-3 lg:mb-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 lg:hidden"
              aria-label="Abrir menú de navegación"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:justify-end">
            <GlobalFiltersBar />
            <UserHeaderInfo />
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
