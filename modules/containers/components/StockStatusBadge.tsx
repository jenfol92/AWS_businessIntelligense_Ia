export function StockStatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
      }`}
    >
      {label}: {ok ? "Sí" : "No"}
    </span>
  );
}
