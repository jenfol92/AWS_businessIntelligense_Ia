"use client";

import { useMemo } from "react";
import type { useProductForm } from "../../../hooks/useProductForm";
import { InheritanceOverrideControl } from "../InheritanceOverrideControl";
import { calculateCubicajeUnitarioM3 } from "../../../utils/calculateCubicajeUnitarioM3";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
} from "../productFormUi";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function toNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h3>
  );
}

/** Materiales, pesos y medidas (`producto_ficha_tecnica`). */
export function ProductFormFichaSection({ form }: Props) {
  const { values, updateField } = form;

  const cbmPreview = useMemo(
    () =>
      calculateCubicajeUnitarioM3(
        values.largoCajaCm,
        values.anchoCajaCm,
        values.altoCajaCm,
      ),
    [values.largoCajaCm, values.anchoCajaCm, values.altoCajaCm],
  );

  return (
    <section className={pfCard} aria-labelledby="product-section-ficha">
      <div className={pfCardHeader}>
        <h2 id="product-section-ficha" className={pfCardTitle}>
          Materiales, pesos y medidas
        </h2>
      </div>
      <div className={pfCardBody}>
        <SectionTitle>Materiales</SectionTitle>
        <div className={pfGrid}>
          <div>
            <label className={pfLabel} htmlFor="pf-mat-est">
              Material estructura
            </label>
            <input
              id="pf-mat-est"
              className={pfFieldClass(false)}
              value={values.materialEstructura}
              onChange={(e) =>
                updateField("materialEstructura", e.target.value)
              }
            />
            <InheritanceOverrideControl form={form} field="materialEstructura" />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-mat-tap">
              Material tapizado
            </label>
            <input
              id="pf-mat-tap"
              className={pfFieldClass(false)}
              value={values.materialTapizado}
              onChange={(e) =>
                updateField("materialTapizado", e.target.value)
              }
            />
            <InheritanceOverrideControl form={form} field="materialTapizado" />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-mat-ruedas">
              Material ruedas
            </label>
            <input
              id="pf-mat-ruedas"
              className={pfFieldClass(false)}
              value={values.materialRuedas}
              onChange={(e) => updateField("materialRuedas", e.target.value)}
            />
            <InheritanceOverrideControl form={form} field="materialRuedas" />
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle>Pesos</SectionTitle>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-peso-neto">
                Peso neto (kg)
              </label>
              <input
                id="pf-peso-neto"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.pesoNetoKg > 0 ? values.pesoNetoKg : ""}
                onChange={(e) =>
                  updateField("pesoNetoKg", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="pesoNetoKg" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-peso-bruto">
                Peso bruto (kg)
              </label>
              <input
                id="pf-peso-bruto"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.pesoBrutoKg > 0 ? values.pesoBrutoKg : ""}
                onChange={(e) =>
                  updateField("pesoBrutoKg", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="pesoBrutoKg" />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle>Caja</SectionTitle>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-alto-caja">
                Alto caja (cm)
              </label>
              <input
                id="pf-alto-caja"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.altoCajaCm > 0 ? values.altoCajaCm : ""}
                onChange={(e) =>
                  updateField("altoCajaCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="altoCajaCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-ancho-caja">
                Ancho caja (cm)
              </label>
              <input
                id="pf-ancho-caja"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.anchoCajaCm > 0 ? values.anchoCajaCm : ""}
                onChange={(e) =>
                  updateField("anchoCajaCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="anchoCajaCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-largo-caja">
                Largo caja (cm)
              </label>
              <input
                id="pf-largo-caja"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.largoCajaCm > 0 ? values.largoCajaCm : ""}
                onChange={(e) =>
                  updateField("largoCajaCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="largoCajaCm" />
            </div>
          </div>
          {cbmPreview != null && (
            <p className="mt-3 text-sm text-slate-600">
              Cubicaje unitario:{" "}
              <span className="font-semibold text-slate-800">
                {cbmPreview.toFixed(6)} m³
              </span>
            </p>
          )}
        </div>

        <div className="mt-6">
          <SectionTitle>Producto abierto</SectionTitle>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-alto-abierto">
                Alto abierto (cm)
              </label>
              <input
                id="pf-alto-abierto"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.altoAbiertoCm > 0 ? values.altoAbiertoCm : ""}
                onChange={(e) =>
                  updateField("altoAbiertoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="altoAbiertoCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-ancho-abierto">
                Ancho abierto (cm)
              </label>
              <input
                id="pf-ancho-abierto"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.anchoAbiertoCm > 0 ? values.anchoAbiertoCm : ""}
                onChange={(e) =>
                  updateField("anchoAbiertoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="anchoAbiertoCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-fondo-abierto">
                Fondo abierto (cm)
              </label>
              <input
                id="pf-fondo-abierto"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.fondoAbiertoCm > 0 ? values.fondoAbiertoCm : ""}
                onChange={(e) =>
                  updateField("fondoAbiertoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="fondoAbiertoCm" />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle>Producto plegado</SectionTitle>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-alto-plegado">
                Alto plegado (cm)
              </label>
              <input
                id="pf-alto-plegado"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.altoPlegadoCm > 0 ? values.altoPlegadoCm : ""}
                onChange={(e) =>
                  updateField("altoPlegadoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="altoPlegadoCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-ancho-plegado">
                Ancho plegado (cm)
              </label>
              <input
                id="pf-ancho-plegado"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.anchoPlegadoCm > 0 ? values.anchoPlegadoCm : ""}
                onChange={(e) =>
                  updateField("anchoPlegadoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="anchoPlegadoCm" />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-fondo-plegado">
                Fondo plegado (cm)
              </label>
              <input
                id="pf-fondo-plegado"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={values.fondoPlegadoCm > 0 ? values.fondoPlegadoCm : ""}
                onChange={(e) =>
                  updateField("fondoPlegadoCm", toNum(e.target.value))
                }
              />
              <InheritanceOverrideControl form={form} field="fondoPlegadoCm" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
