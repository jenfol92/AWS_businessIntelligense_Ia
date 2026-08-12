# Auditoría del módulo financiero

**Fecha:** 2026-08-06
**Ámbito:** repositorio local y stack Supabase/PostgreSQL local en Docker `ERP_BACKUP`
**Base inspeccionada:** PostgreSQL 17.6, contenedor `supabase_db_ERP_BACKUP`, base `postgres`
**Restricciones respetadas:** sin conexión ni escritura en Supabase remoto; sin migraciones; sin DDL/DML persistente; sin correcciones de código. Los tests SQL ejecutados terminaron en `ROLLBACK`. La única escritura deliberada de esta fase es este informe.

## 1. Resumen ejecutivo

El módulo financiero ya no es una maqueta: contiene planificación de tesorería, pagos a proveedor, lotes de pagos, cuentas de caja, líneas de crédito, disposiciones, amortizaciones, vencimientos reales y previstos, regularización de saldos legacy y obligaciones no vinculadas. La ruta de producción local compila y el esquema Docker contiene 19 tablas `finance_*`, 2 vistas, 46 rutinas relacionadas, 21 eventos de trigger, 51 claves foráneas y 81 índices.

No está preparado para migración remota ni para producción. El motivo principal no es la falta de volumen funcional, sino la ausencia de una cadena reproducible y auditable de migraciones: los SQL viven en `sql/migrations` con dos convenciones de nombre, varias generaciones redefinen las mismas funciones, hay migraciones financieras recientes sin seguimiento Git y la base local no contiene `supabase_migrations.schema_migrations`. Por tanto, se puede observar el estado final local, pero no demostrar de forma determinista qué secuencia lo produjo ni comparar automáticamente ese estado con remoto.

Los controles de integridad han mejorado de forma importante: operaciones sensibles se encapsulan en RPC atómicas, existen bloqueos, claves idempotentes, restricciones, RLS y triggers de inmutabilidad. Sin embargo, el esquema local conserva una fila de pago proveedor con `status='pagado'` sin `actual_amount_original` ni `actual_amount_eur`; el código la trata mediante fallback legacy. Esto evita romper la lectura, pero mezcla evidencia bancaria real con compatibilidad histórica y falsea potencialmente agregados.

La previsión de tesorería se calcula casi enteramente en TypeScript (`buildFinancialPlanning.ts`) a partir de lecturas crudas. Es útil como read model, pero concentra reglas financieras críticas —saldo proyectado, crédito disponible, prioridad de fuentes, liberación de principal, conversión y clasificación temporal— fuera de una función versionada y testeable de base/backend. La UI también recalcula sumas y validaciones. Esta duplicación aumenta el riesgo de divergencia.

Amazon no aporta todavía liquidaciones quincenales confirmadas al módulo: `finance_amazon_income_forecasts` está vacío y representa previsiones manuales. Existen tablas de importación/transacciones Amazon, pero no se encontró conciliación financiera canónica entre transacciones/liquidaciones y movimientos de caja. Tampoco existen escenarios persistidos, reservas de seguridad, umbrales de tensión de tesorería ni separación formal de inversión en reposición frente a productos nuevos.

### Dictamen de preparación

| Nivel | Dictamen |
|---|---|
| Funcional localmente | **Sí, parcialmente**, para planificación, pagos, líneas, vencimientos y obligaciones; build correcto y varios tests SQL pasan. |
| Probada | **Parcialmente**: 15/20 pruebas Node pasan; 5 no arrancan por incompatibilidad del runner. Varios tests SQL pasan y otros fallan por fixtures/expectativas desalineadas. |
| Preparada para migración | **No**: no hay historial de migraciones de aplicación ni baseline reproducible; hay SQL recientes sin seguimiento Git y drift no demostrable automáticamente. |
| Preparada para producción | **No**: integridad legacy pendiente, permisos/grants por sanear, cobertura incompleta y previsión/conciliación Amazon incompletas. |

## 2. Arquitectura general y tecnologías

- **Frontend:** Next.js 14.2 App Router, React 18, TypeScript 5, Tailwind, Tremor, Recharts, `next-intl` y Framer Motion.
- **Backend:** route handlers de Next.js en `app/api`; servicios y repositorios por módulo; Supabase JS/SSR como cliente de datos y autenticación.
- **Base de datos:** PostgreSQL/Supabase. La lógica transaccional crítica se implementa en PL/pgSQL mediante RPC `SECURITY DEFINER` con wrappers de autorización.
- **Docker local:** stack Supabase CLI/Compose denominado `ERP_BACKUP`; DB, Kong, Auth, REST, Realtime, Storage, Studio, Meta y Analytics activos. `supabase_vector_ERP_BACKUP` estaba reiniciándose durante la auditoría.
- **Configuración:** no existe `supabase/config.toml` ni compose versionado en el repositorio. `.env.local` apunta a un host Supabase remoto; las validaciones se ejecutaron con variables efímeras forzadas a `127.0.0.1:54321`.
- **TypeScript:** `strict: false`, `allowJs: true` y `skipLibCheck: true`; reduce el poder del type-check como control financiero.
- **Pruebas:** archivos Node `*.test.mjs` sin script `test` en `package.json`; diagnósticos SQL manuales bajo `sql/diagnostics`.

## 3. Mapa de archivos del módulo

### Rutas y páginas

- `app/[locale]/(dashboard)/finanzas/page.tsx`: redirige a planificación.
- `app/[locale]/(dashboard)/finanzas/planificacion/page.tsx`: monta `FinancialPlanningPage`.
- `app/api/finance/planning/route.ts`: read model de planificación.
- `app/api/finance/supplier-payments/*`: backfill, marcado pagado y financiación.
- `app/api/finance/purchase-payment-*`: candidatos, creación y detalle de lotes.
- `app/api/finance/credit-lines/*`: vencimientos, vencimientos previstos, amortización y apertura legacy.
- `app/api/finance/unlinked-*` y `treasury/unlinked-commitments`: obligaciones no vinculadas, recurrencia, cuotas y lectura segura.

### Componentes

- `FinancialPlanningPage.tsx`: calendario, KPIs, pagos, modales y composición principal.
- `CreditLineMaturitiesSection.tsx`: amortización y regularización legacy.
- `CreditLinePlannedMaturitiesSection.tsx`: CRUD de calendario previsto.
- `LinkedPurchasePaymentModal.tsx` y `PurchasePaymentBatchDetailModal.tsx`: pago agrupado y detalle.
- `FinancePage.tsx`, `FinanceKpiCards.tsx`, `FinanceFilters.tsx`, `ProfitabilityTable.tsx`: archivos vacíos; restos de una superficie anterior.

### Servicios y repositorios

- `buildFinancialPlanning.ts` + `financialPlanningRepository.ts`: read model principal.
- `syncSupplierPaymentsForOrder.ts`: genera/sincroniza obligaciones de depósito y balance desde órdenes.
- `supplierPaymentExecutionService.ts`, `supplierPaymentFinanceService.ts`: validación y orquestación de pago/financiación.
- `purchasePaymentBatchService.ts`: lotes vinculados y asignaciones.
- `creditLineLedgerService.ts`, repositorios de ledger/maturities: disposiciones, amortizaciones, vencimientos y regularización.
- `unlinkedObligations*`: obligaciones externas a pedidos, plantillas, cuotas, pagos y read models.
- `syncFxRates.ts`/`fxRatesRepository.ts`: soporte de tipos de cambio; no se integra como fuente única en toda la planificación.
- `calculateFinancialSummary.ts`, `getFinanceDashboard.ts`, `getProfitability.ts`, hooks/mappers/cálculos: archivos vacíos o legado no conectado a la página vigente.

### SQL

- Base histórica sin prefijo fecha: `finance_planning_base.sql`, `finance_supplier_payments*.sql`, `finance_credit_lines_*`.
- Cadena incremental fechada: `20260721_*` a `20260805_*` para pagos, lotes, líneas, vencimientos, obligaciones y autorización.
- Diagnósticos: `sql/diagnostics/finance_*`, `credit_line_*`, `supplier_payment_*`.
- Fixtures: `sql/data/20260804_credit_line_planned_maturities.sql` (33 vencimientos previstos).

## 4. Diagrama textual de entidades y relaciones

```text
proveedores ----< finance_purchase_payment_batches >---- agentes_compra
      |                         |
      |                         v
ordenes_compra ----< finance_supplier_payments >---- finance_purchase_payment_allocations
      |                         |                              |
      |                         +---- contenedores             +---- batch
      |                         +---- finance_cash_accounts
      |                         +---- finance_credit_lines
      |
      +---- orden_items (cantidad/coste/moneda; base del plan proveedor)

finance_cash_accounts ----< finance_cash_movements
          ^                          ^
          |                          |
finance_credit_lines ----< finance_credit_line_movements
          |                          |
          +----< finance_credit_line_repayment_groups
          |               |
          |               +----< finance_credit_line_repayments >---- cash account/movement
          |
          +----< finance_credit_line_planned_maturities
          |
          +----< finance_credit_line_legacy_regularizations
                          |
                          +----< regularization_items

finance_unlinked_obligation_templates ----< finance_unlinked_obligations
                                                     |
                                                     +----< installments
                                                     +----< payments
                                                               |
                                                               +----< allocations >---- installments
                                                               +---- cash/credit ledger

finance_amazon_income_forecasts   (sin FK a liquidación/transacción Amazon)
finance_settings                  (clave/valor, sin FK)
fx_rates_daily                    (fuera del prefijo finance, sin relación declarativa al plan)
```

## 5. Inventario del esquema financiero local

| Tabla | Columnas | Filas observadas | Papel | Estado |
|---|---:|---:|---|---|
| `finance_cash_accounts` | 7 | 1 | cuentas/saldo de caja | funcional localmente |
| `finance_cash_movements` | 11 | 0 | ledger de caja | implementada parcialmente |
| `finance_credit_lines` | 18 | 3 | límites, usado, disponible, condiciones | funcional localmente |
| `finance_credit_line_movements` | 17 | 0 | disposiciones/amortizaciones | implementada parcialmente |
| `finance_credit_line_repayment_groups` | 14 | 0 | deuda agrupada/vencimientos reales | implementada parcialmente |
| `finance_credit_line_repayments` | 23 | 0 | asiento inmutable de amortización | probada parcialmente |
| `finance_credit_line_planned_maturities` | 18 | 33 | calendario previsto no contable | probada localmente |
| `finance_credit_line_legacy_regularizations` | 9 | 0 | cabecera de explicación de saldo legacy | probada localmente |
| `...legacy_regularization_items` | 11 | 0 | desglose por disposición/vencimiento | probada localmente |
| `finance_supplier_payments` | 25 | 62 | obligaciones depósito/balance | funcional localmente, con incidencia legacy |
| `finance_purchase_payment_batches` | 26 | 0 | ejecución agrupada real | implementada parcialmente |
| `finance_purchase_payment_allocations` | 9 | 0 | reparto lote-obligación | implementada parcialmente |
| `finance_unlinked_obligations` | 20 | 0 | obligaciones no ligadas a compra | implementada parcialmente |
| `...installments` | 16 | 0 | cuotas/revisiones | implementada parcialmente |
| `...payments` | 23 | 0 | pagos reales no vinculados | implementada parcialmente |
| `...payment_allocations` | 9 | 0 | imputación pago-cuota | implementada parcialmente |
| `...templates` | 20 | 0 | recurrencia | implementada parcialmente |
| `finance_amazon_income_forecasts` | 8 | 0 | ingreso Amazon manual previsto | maquetada/implementada parcialmente |
| `finance_settings` | 3 | no contado | configuración clave/valor | implementada parcialmente |

Además existen dos vistas de saldo de obligaciones no vinculadas: `finance_unlinked_installment_balances` y `finance_unlinked_obligation_balances`.

### Restricciones, índices y controles destacados

- 51 FKs financieras. La mayoría de asientos usa `RESTRICT`; algunos vínculos base usan `CASCADE` o `SET NULL`.
- 81 índices. Hay idempotencia en movimientos, amortizaciones, lotes, vencimientos previstos, obligaciones recurrentes y fuentes de disposiciones.
- Duplicidad confirmada: `ux_finance_supplier_payments_orden_type` y `ux_finance_supplier_payments_order_type` indexan exactamente `(orden_id, payment_type)`.
- Triggers de inmutabilidad para amortizaciones y regularizaciones legacy.
- Trigger de financiación real antes de aceptar un pago proveedor como pagado.
- Triggers diferidos/de integridad para cuotas y asignaciones de obligaciones no vinculadas.
- `finance_credit_lines` mantiene simultáneamente `credit_limit`, `used_amount` y `available_amount`: tres valores derivados/persistidos que exigen atomicidad. No se observó drift aritmético en las 3 líneas actuales.

## 6. RLS, permisos y autorización

Todas las 19 tablas `finance_*` tienen RLS activado. Quince tienen alguna política; cuatro no tienen políticas: `finance_amazon_income_forecasts`, `finance_cash_movements`, `finance_credit_line_movements` y `finance_settings`. El acceso normal a estas depende de RPC `SECURITY DEFINER`, service role o resulta bloqueado.

Riesgos:

1. `finance_supplier_payments` conserva políticas `INSERT` y `UPDATE` para cualquier `authenticated` con `true`, aunque grants actuales revocan esas operaciones. Es una defensa accidentalmente dependiente de dos capas divergentes: un cambio futuro de grants reabriría escritura directa.
2. `finance_purchase_payment_batches` y allocations muestran privilegios de tabla amplios para `authenticated`, aunque RLS solo define lectura. Deben normalizarse antes de remoto.
3. Varias tablas base muestran privilegios amplios para `anon` en catálogo. RLS sin política los bloquea hoy, pero el principio de mínimo privilegio no se cumple a nivel grants.
4. La política de vencimientos previstos figura con rol `{public}` y función `finance_can_read_treasury()`. Funcionalmente filtra, pero es inconsistente con el resto de políticas `{authenticated}`.
5. La autorización de aplicación se basa en `app_metadata.role` (`admin`, `accounting`, `logistics`) y se duplica entre TypeScript y funciones SQL. Es necesario probar equivalencia contractual.

## 7. Flujo actual de datos

1. Proveedor/orden define moneda, porcentaje de depósito y vencimiento de balance.
2. Confirmar una orden o vincularla a contenedor llama a `syncSupplierPaymentsForOrder`; se materializan depósito/balance en `finance_supplier_payments`.
3. Planificación lee en paralelo contenedores, pagos, líneas, grupos reales, vencimientos previstos, caja, previsiones Amazon y settings.
4. `buildFinancialPlanning.ts` transforma todo en eventos mensuales y calcula saldos proyectados y recomendaciones de fuente.
5. Pago individual o lote registra importe original, EUR real, FX y comisiones; RPC atómica asigna caja o línea de crédito.
6. Una disposición crea movimiento de línea y grupo de devolución; la amortización v2 crea componentes principal/interés/comisiones, movimiento de caja y snapshots de saldo.
7. Obligaciones no vinculadas siguen un ledger paralelo y convergen en movimientos de caja/línea.
8. Los vencimientos previstos son informativos hasta vincularse con amortizaciones reales.
9. Los ingresos Amazon se incorporan solo desde `finance_amazon_income_forecasts`; no hay conciliación confirmada con liquidaciones Amazon.

## 8. Clasificación funcional

| Funcionalidad | Clasificación | Evidencia / límite |
|---|---|---|
| Navegación y calendario financiero | funcional localmente | Página y API compilan; build genera ruta. |
| Cuentas bancarias/caja | implementada parcialmente | Tabla/saldo/UI existen; solo 1 cuenta y 0 movimientos locales. |
| Líneas, límite/usado/disponible | funcional localmente | 3 líneas sin drift; operaciones encapsuladas. |
| Disposiciones y amortización | probada parcialmente | RPC/ledger robustos; sin datos reales locales; tests SQL parciales. |
| Vencimientos reales agrupados | implementada parcialmente | Modelo y UI; 0 grupos locales. |
| Vencimientos previstos | probada | 33 fixtures; test SQL pasa con rollback. |
| Refinanciación línea-a-línea | no iniciada | No existe entidad/RPC explícita de transferencia; solo elegir fuente de pago. |
| Pagos a fábrica individuales | funcional localmente | 62 obligaciones; una inconsistente por legado. |
| Lotes de pagos a fábrica | implementada parcialmente | Esquema/RPC/UI; 0 lotes locales. |
| Transporte/llegada/tránsito | implementada parcialmente | Se deriva de `contenedores`; no hay ledger contable propio por concepto. |
| Impuestos | no iniciada | No hay obligación/impuesto canónico integrado al calendario. |
| Monedas y FX real | implementada parcialmente | Campos y `fx_rates_daily`; múltiples fallbacks y fuentes sin política única. |
| Ingreso Amazon previsto | maquetada | Tabla/lectura; 0 filas y origen manual. |
| Liquidación Amazon confirmada/quincenal | no iniciada | Sin entidad financiera/conciliación/cash movement canónico. |
| Previsión de tesorería | funcional localmente | Calculada en servicio TS; no auditada contra casos reales completos. |
| Escenarios | no iniciada | Sin entidades, API ni UI persistente. |
| Reserva de seguridad | no iniciada | Sin parámetro ni regla financiera. |
| Tensión de tesorería/alertas | maquetada conceptualmente | Saldos proyectados existen; no hay umbral/evento persistido. |
| Inversión en reposición | no iniciada | No hay clasificación financiera separada. |
| Inversión en producto nuevo | no iniciada | No hay clasificación financiera separada. |
| Obligaciones no vinculadas | implementada parcialmente | Modelo completo, sin datos locales; varios tests de contrato. |
| Rentabilidad/ROI/margen/ACOS/COGS | maquetada/legado | Archivos vacíos o cálculos aislados; no conectados a página financiera vigente. |
| Migración remota | no iniciada de forma segura | Falta baseline/historial y dry-run reproducible. |

Ninguna funcionalidad alcanza todavía **preparada para migración** ni **preparada para producción** como conjunto.

## 9. Funcionalidades completas, parciales e inexistentes

### Completas dentro del alcance local observado

- Compilación y generación de las rutas financieras.
- Read-only de planificación sin sincronización implícita durante GET.
- Modelo de vencimientos previstos con validación, idempotencia y concurrencia; test SQL pasa.
- Regularización legacy y amortización por componentes: tests SQL transaccionales pasan.
- Separación de `bank_fee_eur` y `ff_fee_eur`.
- Entrada de pago en moneda origen y cálculo/registro EUR real en backend/RPC.

### Parciales

- Caja y líneas: estructuras fuertes, pero fixtures actuales no ejercitan movimientos reales.
- Lotes de pagos y obligaciones no vinculadas: mucho código/esquema, cero datos locales.
- Previsión: funcional, pero mezcla fallback legacy, reglas operativas y proyección en un único servicio grande.
- FX: coexistencia de `planned_fx_rate`, `actual_fx_rate`, settings globales, tipos del contenedor y `fx_rates_daily`.
- Amazon: existe previsión manual, no liquidación confirmada ni conciliación bancaria.
- RLS: activado en todas las tablas, pero grants/policies no siguen un patrón uniforme.

### Inexistentes

- Conciliación de liquidaciones Amazon quincenales con banco/caja.
- Escenarios versionados (base, pesimista, optimista).
- Reserva mínima configurable y alertas de tensión.
- Refinanciación explícita de una línea con otra con doble asiento trazable.
- Clasificación de CAPEX/OPEX o inversión reposición/nuevo producto.
- Subsistema fiscal (IVA/arancel/impuesto devengado/pagado) integrado en tesorería.
- Cierre, conciliación y periodo contable inmutable.

## 10. Errores e inconsistencias encontrados

1. Una fila `finance_supplier_payments` está `pagado` con `actual_amount_original` y `actual_amount_eur` nulos; tiene FX 0,87 y fecha 2026-06-25.
2. Dos índices únicos duplican `(orden_id, payment_type)` con variantes `orden`/`order`.
3. `FinancePage.tsx`, KPIs, filtros, rentabilidad, hooks, mappers y varios cálculos son archivos vacíos: estructura muerta que aparenta funcionalidad.
4. `financeRepository.ts` está eliminado en el working tree; no rompe `tsc`, señal de capa abandonada.
5. `next lint` no puede ejecutarse no-interactivamente porque falta configuración ESLint.
6. Cinco pruebas Node fallan al cargar TypeScript por parameter properties no soportadas por Node 24 strip-only.
7. Dos diagnósticos SQL de pagos proveedor fallan porque sus fixtures esperan una orden con depósito y balance explícitos que no existe en el dataset actual.
8. El test de autorización SQL falla: esperaba error de dominio `ADMIN_OR_ACCOUNTING_REQUIRED`, pero recibe antes `permission denied for function`; contrato del test y grants actuales divergen.
9. Mensajes/comentarios muestran mojibake (`ObligaciÃ³n`, `dep??sito`), riesgo para auditoría y UX.
10. `.env.local` apunta a remoto; ejecutar scripts sin override puede violar el aislamiento local.
11. El build pasa, pero registra dos errores de puertos porque las claves locales placeholder no son JWT válidos; no afecta la compilación financiera, sí evidencia acoplamiento durante prerender.
12. `strict:false` y uso frecuente de `Record<string, unknown>` permiten drift de contrato DB/TS sin error de compilación.

## 11. Riesgos técnicos

- **Crítico:** migraciones no reproducibles ni registradas; no se puede certificar el orden aplicado.
- **Crítico:** SQL recientes `20260804_04`, `20260804_05` y `20260805_01`, API/UI/tests asociados aparecen sin seguimiento Git aunque sus objetos/datos existen en Docker.
- **Alto:** migraciones históricas y nuevas redefinen las mismas RPC; aplicar fuera de orden puede reinstalar una versión obsoleta.
- **Alto:** privilegios y RLS se contradicen; seguridad efectiva depende de combinación accidental.
- **Alto:** servicio de planificación monolítico y dinámicamente tipado.
- **Medio:** fuentes FX múltiples sin precedencia formal y trazabilidad uniforme.
- **Medio:** stack Docker no está descrito/versionado en repo; `vector` inestable.
- **Medio:** cobertura Node depende de una característica incompleta del runtime y no hay comando `npm test`.
- **Medio:** código muerto y nomenclatura bilingüe/legacy aumentan ambigüedad.

## 12. Riesgos de integridad financiera

- Un pago pagado sin importes reales puede inflar/reducir pagado, pendiente y FX mediante fallback.
- Persistir límite, usado y disponible permite desalineación si alguna escritura elude RPC.
- Borrar una orden borra en cascada sus obligaciones proveedor; para evidencia financiera ejecutada debería evaluarse `RESTRICT`/archivo lógico.
- Borrar una línea borra movimientos/grupos por `CASCADE` en algunas relaciones; aunque grants/triggers lo dificultan, el modelo declarativo permite pérdida histórica a roles privilegiados.
- Previsiones y hechos comparten el mismo calendario sin ledger de escenario/versionado.
- Ingresos Amazon previstos no se reconcilian con efectivo confirmado.
- Transporte, llegada y tránsito se leen desde cabecera de contenedor, no desde obligaciones/asientos conciliables.
- Cálculos en números JavaScript pueden introducir redondeo; parte de UI usa céntimos, pero no de forma uniforme.
- Los snapshots de saldos en repayments ayudan auditoría, pero no existe cierre/reconciliación periódica global.

## 13. Diferencias entre migraciones y esquema local

### Confirmadas

- La base no tiene esquema/tabla `supabase_migrations.schema_migrations`; solo historiales internos de Auth, Realtime, Storage y Functions.
- El esquema contiene los objetos de migraciones recientes no rastreadas: tabla de vencimientos previstos, 33 filas spreadsheet, funciones endurecidas y `finance_finance_supplier_payment_phase1a_impl`.
- El archivo `20260804_05_credit_line_planned_maturities_hardening.sql` figura modificado localmente; sin checksum/historial no puede demostrarse si Docker coincide con su contenido actual.
- Conviven migraciones sin fecha y fechadas; el diagnóstico `credit_line_maturities_migration_order.sql` marca manualmente estados `pending/dependency`, no consulta un ledger real.
- El esquema tiene dos índices equivalentes de pagos proveedor, consecuencia probable de migraciones históricas con nombres distintos.
- La restricción de `finance_supplier_payments.status` admite `parcial` localmente por migración posterior, mientras scripts base antiguos solo documentan `pendiente/pagado/vencido`.

### No verificable en esta fase

- Diferencia contra Supabase remoto: no se consultó por prohibición expresa.
- Checksum exacto de cada función contra cada archivo: múltiples `CREATE OR REPLACE` hacen necesario generar un baseline canónico primero.
- Orden real de aplicación: el sistema local no lo registra.

## 14. Cálculos que deben centralizarse o protegerse

Prioridad alta:

- saldo de caja proyectado y crédito disponible proyectado;
- liberación de principal frente a intereses/comisiones;
- asignación de fuente recomendada y límites disponibles;
- total financiado `actual_amount_eur + bank_fee_eur + ff_fee_eur` (ya protegido en RPC, mantener allí);
- pendiente por obligación y ponderación FX de lotes;
- clasificación de pagado/parcial/vencido y fecha económica efectiva;
- coherencia `credit_limit = used_amount + available_amount`.

La UI puede mostrar previews, pero la decisión persistible debe recalcularse en RPC/backend con `numeric`, bloqueos e idempotencia. `CreditLinePlannedMaturitiesSection.tsx` y `CreditLineMaturitiesSection.tsx` repiten sumas/validaciones que deben considerarse solo UX, nunca autoridad.

## 15. Pruebas y validaciones ejecutadas

| Validación | Resultado |
|---|---|
| `npx.cmd tsc --noEmit` | **Pasa**, sin salida. Limitado por `strict:false`/`skipLibCheck:true`. |
| `npm.cmd run build` | **Pasa**, 38 páginas; incluye planificación y todas las APIs finance. Dos logs no financieros por JWT placeholder local. |
| `npm.cmd run lint` | **No ejecutable**: abre asistente interactivo por falta de configuración. |
| `node --test modules/finance/**/*.test.mjs` | **15 pasan / 5 fallan**. Las 5 fallan al importar TS con `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. |
| `credit_line_planned_maturities_test.sql` | **Pasa** (`BEGIN`, `DO`, `ROLLBACK`). |
| `credit_line_legacy_regularization_test.sql` | **Pasa**, confirma recuentos intactos tras rollback. |
| `credit_line_repayment_components_test.sql` | **Pasa** con rollback. |
| `credit_line_authorization_and_read_safety_test.sql` | **Falla** por `permission denied` antes del error de dominio esperado; desconexión revierte la transacción. |
| `supplier_payment_plan_sync_concurrency_validation.sql` | **Falla** por fixture sin par depósito/balance; transacción revertida al cerrarse sesión. |
| `supplier_payment_actual_fx_validation.sql` | **Falla** por el mismo pre-requisito de fixture; transacción revertida. |
| Consultas de integridad read-only | 0 drift en líneas; 0 huérfanos de orden; 0 duplicados de plan; 1 pagado sin actuals. |

No se midió cobertura porcentual: no existe instrumentación de coverage.

## 16. Datos seed, fixtures y datos de prueba

- `sql/data/20260804_credit_line_planned_maturities.sql`: 33 filas importadas desde calendario externo; existen en Docker como `spreadsheet_schedule`.
- Los diagnósticos crean datos sintéticos dentro de transacciones y hacen rollback.
- Dataset local: 3 líneas, 1 cuenta, 62 pagos proveedor, 33 vencimientos previstos, sin movimientos, amortizaciones, lotes, obligaciones no vinculadas ni previsiones Amazon.
- No hay una seed financiera integral que construya orden + depósito + balance + pago + financiación + amortización + liquidación Amazon.

## 17. Dependencias con otros módulos

- **Pedidos/órdenes:** fuente de obligaciones, moneda, porcentajes, items y fechas; confirmación dispara sync financiero.
- **Proveedores/agentes:** condiciones de pago, beneficiario y agrupación de lotes.
- **Contenedores/logística:** flete, llegada, tránsito, ETA y vínculo orden; refresca obligaciones y muestra resúmenes.
- **Inventario/planificador:** inversión futura no está clasificada financieramente; planificación de compras es una entrada implícita.
- **Amazon:** tablas/importadores existen, pero no hay puente canónico desde settlement a ingreso confirmado/cash movement.
- **Usuarios/Auth:** autorización por `app_metadata.role`; `auth.users` en auditoría de operaciones.
- **BI:** `modules/bi/repositories/financeBiRepository.ts` es una capa separada; debe alinearse con el ledger canónico para evitar dos verdades.

## 18. Deuda técnica

- Establecer Supabase CLI/config y migraciones timestamp canónicas con checksum.
- Convertir el esquema local actual en baseline declarativo revisado.
- Eliminar/archivar código financiero vacío y APIs legacy solo tras comprobar consumidores.
- Activar TypeScript estricto gradualmente y reemplazar `Record<string, unknown>` por tipos generados de Supabase.
- Configurar ESLint no interactivo y un runner TS estable (`tsx`, Vitest o compilación previa).
- Crear fixtures deterministas e independientes de datos locales preexistentes.
- Unificar vocabulario ES/EN y reparar codificación UTF-8.
- Normalizar grants/RLS y añadir tests de privilegios efectivos.
- Separar ledger real, planificación y escenarios.
- Reducir `buildFinancialPlanning.ts` en políticas de dominio testeables.

## 19. Preguntas funcionales pendientes

1. ¿Qué es una “cuenta bancaria”: saldo contable, saldo disponible, saldo valor o cuenta/caja genérica?
2. ¿Las líneas de crédito son revolving, pólizas, préstamos o confirming? ¿Cómo se calcula interés?
3. ¿Una amortización puede refinanciarse con otra línea y qué doble asiento se exige?
4. ¿Qué fecha gobierna tesorería: orden, valor, cargo bancario, factura o vencimiento contractual?
5. ¿Cómo llega la liquidación Amazon y cuál es su identificador/idempotencia por marketplace?
6. ¿Se requiere conciliación de settlement bruto, fees, reservas, ajustes y neto bancario?
7. ¿Cómo se modelan IVA, aranceles, impuestos diferidos y recuperables?
8. ¿Qué umbral define tensión y reserva mínima por cuenta/moneda?
9. ¿Cómo se clasifica reposición frente a nuevo producto y quién decide esa etiqueta?
10. ¿Qué escenarios y horizonte se necesitan; pueden editarse sin alterar hechos?
11. ¿Se permite borrar órdenes/líneas con historia o todo debe ser cancelación lógica?
12. ¿Logistics debe leer detalle financiero o solo totales no sensibles?
13. ¿Cuál es la política oficial de FX previsto, contratado, bancario y contable?
14. ¿Qué periodo/cierre impide modificaciones retroactivas?

## 20. Propuesta de fases para terminar el módulo

### Fase 0 — Congelación y baseline reproducible

- Congelar DDL financiero, inventariar checksums, incorporar SQL local pendiente a control de versiones.
- Crear `supabase/config.toml`, baseline canónico y ledger de migraciones en una base Docker nueva no destructiva.
- Comparar dos bases locales: reconstruida desde cero versus `ERP_BACKUP` mediante schema diff.
- Criterio: diff vacío explicado y todas las migraciones aplicables una sola vez.

### Fase 1 — Integridad y seguridad

- Regularizar la fila pagada sin actuals mediante decisión auditada, no backfill heurístico.
- Unificar índices, constraints, grants y policies; prohibir deletes destructivos de historia financiera.
- Probar matriz anon/authenticated/logistics/accounting/admin/service_role.
- Criterio: preflight e integridad a cero incidencias.

### Fase 2 — Toolchain y contrato

- ESLint no interactivo, runner TS estable, coverage y tipos Supabase generados.
- Fixtures deterministas y test E2E local de ciclo completo.
- Criterio: lint/type/build/tests verdes en CI local sin remoto.

### Fase 3 — Ledger y conciliación Amazon

- Modelar settlements quincenales, componentes, reservas, ajustes, neto y conciliación bancaria.
- Generar cash movements confirmados sin mezclar previsión.
- Criterio: settlement a banco conciliado e idempotente.

### Fase 4 — Tesorería y escenarios

- Separar hechos, previsión base y escenarios versionados.
- Añadir reservas, umbrales, alertas y stress tests.
- Centralizar reglas críticas en backend/RPC numeric.
- Criterio: proyección reproducible y explicable por evento.

### Fase 5 — Fiscalidad y clasificación de inversión

- Obligaciones fiscales, aranceles, IVA; clasificación reposición/nuevo producto.
- Criterio: calendario y reporting sin doble conteo.

### Fase 6 — Ensayo de migración y producción

- Restaurar copia local nueva, aplicar baseline + migraciones, cargar copia anonimizada y ejecutar suite.
- Solo después generar plan remoto de solo lectura/dry-run y aprobación humana.
- Criterio: reconciliación de saldos, checksums, rollback operativo y runbook aprobados.

## 21. Conclusión

El módulo tiene una base funcional avanzada y controles transaccionales valiosos, pero su madurez aparente supera su madurez operativa. Antes de migrar hay que convertir el estado local en una historia reproducible, limpiar el límite entre legado y hechos reales, cerrar permisos y construir conciliación/fixtures. Aplicar ahora los SQL al remoto sería arriesgado porque el resultado dependería del orden y del estado previo, no de una cadena de migraciones demostrablemente determinista.
