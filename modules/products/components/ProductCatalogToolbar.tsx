// modules/products/components/ProductCatalogToolbar.tsx

"use client";

import { useState } from "react";
import type { ProductCatalogFilterOptions } from "../types/catalog.types";

type ProductCatalogToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onReload: () => void;

  selectedAgentIds: string[];
  onSelectedAgentIdsChange: (value: string[]) => void;

  selectedPorts: string[];
  onSelectedPortsChange: (value: string[]) => void;

  selectedCategories: string[];
  onSelectedCategoriesChange: (value: string[]) => void;

  selectedStates: string[];
  onSelectedStatesChange: (value: string[]) => void;

  options: ProductCatalogFilterOptions;
  loadingOptions: boolean;
};

type MultiSelectOption = {
  value: string;
  label: string;
};

function toggleValue(current: string[], value: string) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);

  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} seleccionados`;

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        <span className="truncate">{summary}</span>
        <span className="ml-2 text-xs text-slate-400">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full min-w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">
              {selected.length} seleccionados
            </span>

            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-auto p-2">
            {options.length === 0 ? (
              <div className="px-2 py-2 text-xs text-slate-400">
                Sin opciones disponibles
              </div>
            ) : (
              options.map((option) => {
                const active = selected.includes(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(toggleValue(selected, option.value))}
                    className={[
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <span className="truncate">{option.label}</span>
                    {active && <span className="ml-2 text-xs">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductCatalogToolbar({
  search,
  onSearchChange,
  onReload,
  selectedAgentIds,
  onSelectedAgentIdsChange,
  selectedPorts,
  onSelectedPortsChange,
  selectedCategories,
  onSelectedCategoriesChange,
  selectedStates,
  onSelectedStatesChange,
  options,
  loadingOptions,
}: ProductCatalogToolbarProps) {
  const stateOptions = options.estados.map((estado) => ({
    value: estado.value,
    label: estado.label,
  }));

  const categoryOptions = options.categorias.map((categoria) => ({
    value: categoria.id,
    label: categoria.nombre,
  }));

  const agentOptions = options.agentes.map((agente) => ({
    value: agente.id,
    label: agente.contacto
      ? `${agente.empresa} · ${agente.contacto}`
      : agente.empresa,
  }));

  const portOptions = options.puertos.map((puerto) => ({
    value: puerto,
    label: puerto,
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 xl:grid-cols-[1fr_180px_220px_220px_180px_auto] xl:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Buscar
          </label>
          <input
            className="h-10 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            placeholder="SKU, nombre o ASIN..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        {loadingOptions ? (
          <div className="text-xs text-slate-400 xl:col-span-4">
            Cargando filtros...
          </div>
        ) : (
          <>
            <MultiSelectDropdown
              label="Estado"
              options={stateOptions}
              selected={selectedStates}
              onChange={onSelectedStatesChange}
              placeholder="Todos"
            />

            <MultiSelectDropdown
              label="Categoría"
              options={categoryOptions}
              selected={selectedCategories}
              onChange={onSelectedCategoriesChange}
              placeholder="Todas"
            />

            <MultiSelectDropdown
              label="Agente"
              options={agentOptions}
              selected={selectedAgentIds}
              onChange={onSelectedAgentIdsChange}
              placeholder="Todos"
            />

            <MultiSelectDropdown
              label="Puerto"
              options={portOptions}
              selected={selectedPorts}
              onChange={onSelectedPortsChange}
              placeholder="Todos"
            />
          </>
        )}

        <button
          type="button"
          onClick={onReload}
          className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}