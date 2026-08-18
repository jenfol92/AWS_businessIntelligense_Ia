/**

 * Módulo  : shared/layout

 * Archivo : Sidebar.tsx

 * Qué hace: Navegación lateral del dashboard con grupos, subitems y locale dinámico.

 * Responsabilidad: Renderizar menú desktop/drawer móvil y resolver estado activo por ruta.

 * NO debe: Crear rutas, hardcodear locale, ni contener lógica de negocio de módulos.

 */



"use client";



import Link from "next/link";

import { useParams, usePathname } from "next/navigation";

import type { LucideIcon } from "lucide-react";

import {

  Boxes,

  CalendarClock,

  CalendarDays,

  CalendarRange,

  CircleDollarSign,

  Globe2,


  LayoutDashboard,

  LayoutList,

  Package,

  PackageSearch,

  Route,

  Ship,

  ShoppingCart,

  Truck,

  X,

} from "lucide-react";

import { twMerge } from "tailwind-merge";

import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";



type NavBadge = "Beta" | "Nuevo" | "Próximamente";



type NavItem = {

  label: string;

  /** Ruta sin locale; omitir si el ítem es solo agrupador o está deshabilitado. */

  path?: string;

  icon: LucideIcon;

  /** Activo solo con coincidencia exacta (p. ej. `/planificador` vs hijos). */

  exact?: boolean;

  badge?: NavBadge;

  /** Ítem visible pero sin navegación (p. ej. ruta aún no implementada). */

  disabled?: boolean;

  children?: NavItem[];

};



type NavGroup = {

  title: string;

  items: NavItem[];

};



const NAV_GROUPS: NavGroup[] = [
  {
    title: "Dashboard",
    items: [{ label: "Dashboard", path: "/", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Operaciones",
    items: [
      { label: "Pedidos", path: "/pedidos", icon: ShoppingCart },
      { label: "Inventario", path: "/inventario", icon: Package },
      { label: "Logística", path: "/logistica", icon: Ship, exact: true },
      {
        label: "Planificador",
        icon: CalendarRange,
        children: [
          { label: "Resumen", path: "/planificador", icon: LayoutList, exact: true },
          {
            label: "Llegadas",
            path: "/planificador/llegadas",
            icon: CalendarClock,
            exact: true,
          },
          {
            label: "Planificador anual",
            path: "/planificador/anual",
            icon: CalendarDays,
            badge: "Nuevo",
          },
          {
            label: "Calendario logístico",
            path: "/planificador/logistica",
            icon: Route,
            exact: true,
          },
        ],
      },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { label: "Productos", path: "/productos", icon: Boxes },
      { label: "Proveedores", path: "/proveedores", icon: Truck },
    ],
  },
  {
    title: "Finanzas",
    items: [{ label: "Finanzas", path: "/finanzas", icon: CircleDollarSign }],
  },
  {
    title: "IA y Gestión",
    items: [
      { label: "COO", path: "/coo", icon: Globe2 },
      {
        label: "Amazon Envíos",
        path: "/amazon/envios",
        icon: PackageSearch,
        badge: "Beta",
      },
    ],
  },
];



function resolveLocale(raw: string | string[] | undefined): string {

  const value = Array.isArray(raw) ? raw[0] : raw;

  return isLocale(value) ? value : DEFAULT_LOCALE;

}



/** Construye href con prefijo de locale. */

export function buildNavHref(locale: string, path: string): string {

  if (path === "/") return `/${locale}`;

  return `/${locale}${path}`;

}



/**

 * Resuelve si un ítem de navegación está activo.

 * Con `exact`, evita marcar padres cuando una ruta hija coincide (p. ej. planificador).

 */

export function isNavItemActive(

  pathname: string,

  locale: string,

  item: Pick<NavItem, "path" | "exact">,

): boolean {

  if (!item.path) return false;



  const href = buildNavHref(locale, item.path);



  if (item.exact) {

    return pathname === href || pathname === `${href}/`;

  }



  return pathname === href || pathname.startsWith(`${href}/`);

}



function isAnyChildActive(pathname: string, locale: string, item: NavItem): boolean {

  if (!item.children?.length) return false;

  return item.children.some(

    (child) => child.path && !child.disabled && isNavItemActive(pathname, locale, child),

  );

}



function badgeClassName(badge: NavBadge): string {

  if (badge === "Próximamente") {

    return "shrink-0 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-slate-500/25";

  }

  return "shrink-0 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 ring-1 ring-cyan-500/25";

}



type SidebarProps = {

  mobileOpen: boolean;

  onNavigate: () => void;

  onClose: () => void;

};



type NavRowProps = {

  item: NavItem;

  locale: string;

  pathname: string;

  onNavigate: () => void;

  nested?: boolean;

};



function NavRow({ item, locale, pathname, onNavigate, nested = false }: NavRowProps) {

  const Icon = item.icon;

  const active = item.path ? isNavItemActive(pathname, locale, item) : false;

  const disabled = item.disabled === true;



  const rowClass = twMerge(

    "group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition",

    nested ? "pl-9 pr-3" : "px-3",

    disabled

      ? "cursor-not-allowed border-l-2 border-transparent text-slate-500 opacity-70"

      : active

        ? "border-l-2 border-indigo-400 bg-indigo-500/15 pl-[calc(0.75rem-2px)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"

        : "border-l-2 border-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white",

    nested && active && "pl-[calc(2.25rem-2px)]",

    nested && !active && !disabled && "hover:bg-slate-800/50",

  );



  const iconClass = twMerge(

    "h-[18px] w-[18px] shrink-0",

    disabled

      ? "text-slate-600"

      : active

        ? "text-indigo-300"

        : "text-slate-500 group-hover:text-slate-300",

  );



  const content = (

    <>

      <Icon className={iconClass} strokeWidth={2} aria-hidden />

      <span className="min-w-0 flex-1 truncate">{item.label}</span>

      {item.badge ? <span className={badgeClassName(item.badge)}>{item.badge}</span> : null}

    </>

  );



  if (disabled || !item.path) {

    return (

      <span className={rowClass} aria-disabled="true">

        {content}

      </span>

    );

  }



  return (

    <Link

      href={buildNavHref(locale, item.path)}

      onClick={onNavigate}

      className={rowClass}

      aria-current={active ? "page" : undefined}

    >

      {content}

    </Link>

  );

}



function NavItemBlock({

  item,

  locale,

  pathname,

  onNavigate,

}: NavRowProps) {

  const hasChildren = (item.children?.length ?? 0) > 0;

  const sectionActive = hasChildren && isAnyChildActive(pathname, locale, item);



  if (!hasChildren) {

    return <NavRow item={item} locale={locale} pathname={pathname} onNavigate={onNavigate} />;

  }



  const SectionIcon = item.icon;



  return (

    <div className="space-y-1">

      <div

        className={twMerge(

          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-400",

          sectionActive && "text-slate-200",

        )}

      >

        <SectionIcon

          className={twMerge(

            "h-[18px] w-[18px] shrink-0",

            sectionActive ? "text-indigo-300/80" : "text-slate-500",

          )}

          strokeWidth={2}

          aria-hidden

        />

        <span className="min-w-0 flex-1 truncate">{item.label}</span>

      </div>



      <ul className="ml-3 space-y-0.5 border-l border-slate-800/80 pl-2">

        {item.children!.map((child) => (

          <li key={`${item.label}-${child.label}`}>

            <NavRow

              item={child}

              locale={locale}

              pathname={pathname}

              onNavigate={onNavigate}

              nested

            />

          </li>

        ))}

      </ul>

    </div>

  );

}



/** Sidebar principal: fija en desktop y drawer deslizable en móvil. */

export default function Sidebar({

  mobileOpen,

  onNavigate,

  onClose,

}: SidebarProps) {

  const pathname = usePathname();

  const params = useParams();

  const locale = resolveLocale(params.locale);



  return (

    <aside

      className={twMerge(

        "fixed inset-y-0 left-0 z-50 flex h-screen w-72 flex-col border-r border-slate-800/80 bg-gradient-to-b from-slate-950 via-slate-950 to-blue-950 shadow-xl transition-transform duration-200 ease-out lg:w-64 lg:translate-x-0",

        mobileOpen ? "translate-x-0" : "-translate-x-full",

      )}

      aria-label="Navegación principal"

    >

      <div className="flex items-start justify-between gap-3 border-b border-slate-800/90 px-5 py-5">

        <div className="min-w-0">

          <p className="truncate text-base font-semibold tracking-tight text-white">

            ERP BI IA

          </p>

          <p className="mt-0.5 text-xs font-medium text-slate-400">

            Business Intelligence

          </p>

        </div>



        <button

          type="button"

          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800/80 hover:text-white lg:hidden"

          aria-label="Cerrar menú de navegación"

          onClick={onClose}

        >

          <X className="h-5 w-5" strokeWidth={2} aria-hidden />

        </button>

      </div>



      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">

        {NAV_GROUPS.map((group) => (

          <div key={group.title}>

            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">

              {group.title}

            </p>

            <ul className="space-y-1">

              {group.items.map((item) => (

                <li key={item.label}>

                  <NavItemBlock

                    item={item}

                    locale={locale}

                    pathname={pathname}

                    onNavigate={onNavigate}

                  />

                </li>

              ))}

            </ul>

          </div>

        ))}

      </nav>

    </aside>

  );

}

