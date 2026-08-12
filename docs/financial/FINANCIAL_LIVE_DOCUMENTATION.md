# Documentación viva del módulo financiero

**Estado observado:** 2026-08-06
**Código:** `C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA`
**Esquema efectivo:** PostgreSQL 17.6, contenedor local `supabase_db_ERP_BACKUP`
**Naturaleza:** referencia descriptiva del comportamiento actual.

## Convenciones de evidencia

- **Implementado:** demostrado por código conectado y/o objeto efectivo del catálogo.
- **Deducido:** consecuencia directa de código/esquema, no ejercitada con datos locales en esta documentación.
- **No verificado:** requiere ejecución funcional, datos ausentes o una fuente no permitida.
- **Legado/no conectado:** existe físicamente, pero no participa en la página o flujo vigente demostrado.

Las referencias `archivo:línea` corresponden al estado local inspeccionado. Los objetos SQL se citan por nombre y firma efectiva del catálogo.

## 1. Alcance actual del módulo

La entrada web `/[locale]/finanzas` redirige a `/[locale]/finanzas/planificacion`; la página efectiva monta `FinancialPlanningPage` (`app/[locale]/(dashboard)/finanzas/page.tsx`, `.../planificacion/page.tsx`).

Funcionalidades implementadas y conectadas:

- calendario mensual de pagos, costes logísticos, ingresos previstos y vencimientos de líneas;
- resumen de caja, límite/usado/disponible de crédito y pagos del horizonte;
- depósito/balance de órdenes de compra;
- pago individual desde cuenta o línea y pago agrupado vinculado;
- lectura y amortización de vencimientos reales;
- registro y mantenimiento de vencimientos previstos;
- regularización de saldo inicial legacy;
- APIs de obligaciones no vinculadas, cuotas, plantillas y recurrencia;
- lectura de compromisos no vinculados para tesorería.

No existe una UI conectada demostrada para administrar obligaciones no vinculadas; sí existen APIs/servicios. No hay comportamiento implementado de liquidación Amazon real o conciliación bancaria. Evidencia: `FinancialPlanningPage.tsx`, `CreditLineMaturitiesSection.tsx`, `CreditLinePlannedMaturitiesSection.tsx`, `app/api/finance/**` y ausencia de consumidores UI de `/api/finance/unlinked-*`.

## 2. Arquitectura real

```text
Página Next.js
  -> componente cliente FinancialPlanningPage
     -> fetch /api/finance/planning
        -> requireTreasuryAccess
        -> buildFinancialPlanning
           -> financialPlanningRepository
              -> Supabase route client
                 -> tablas/vistas PostgreSQL bajo RLS
           -> transformación TypeScript a eventos y buckets
     -> acciones/modales
        -> API financiera específica
           -> validación TypeScript
           -> servicio/repositorio
           -> supabase.rpc(...)
           -> wrapper SECURITY DEFINER
           -> función efectiva/impl PL/pgSQL
           -> locks + tablas + triggers/constraints
        -> respuesta JSON
     -> recarga de planificación desde servidor
```

Recorrido típico implementado para pagar a proveedor:

```text
PaymentModal
 -> PATCH /api/finance/supplier-payments/{id}/mark-paid
 -> normalizeMarkSupplierPaymentPaidInput
 -> markSupplierPaymentPaid
 -> markAndFinanceSupplierPaymentRpc
 -> mark_and_finance_supplier_payment(...)
 -> pago real + fuente caja/línea en una transacción
 -> finance_supplier_payments
 -> finance_cash_movements/finance_cash_accounts
    o finance_credit_line_movements/repayment_groups/credit_lines
 -> trigger trg_require_real_funding_on_supplier_payment_paid
 -> JSON -> recarga /api/finance/planning
```

Los hooks financieros presentes están vacíos; la UI usa `fetch` directo. Los repositorios encapsulan `.from`/`.rpc`; la planificación aplica reglas en servicio TypeScript. Las vistas solo intervienen en read models de obligaciones no vinculadas.

## 3. Mapa de archivos

### Páginas

| Archivo | Responsabilidad |
|---|---|
| `app/[locale]/(dashboard)/finanzas/page.tsx` | redirección a planificación |
| `app/[locale]/(dashboard)/finanzas/planificacion/page.tsx` | montaje de `FinancialPlanningPage` |

### Componentes conectados

| Archivo | Responsabilidad |
|---|---|
| `modules/finance/components/FinancialPlanningPage.tsx` | KPIs, filtros, buckets mensuales, eventos, modal de pago y composición |
| `CreditLineMaturitiesSection.tsx` | vencimientos reales, amortización y regularización legacy |
| `CreditLinePlannedMaturitiesSection.tsx` | listado/alta de vencimientos previstos |
| `LinkedPurchasePaymentModal.tsx` | selección y ejecución de pago agrupado |
| `PurchasePaymentBatchDetailModal.tsx` | detalle de un lote ejecutado |

### APIs

Los 21 archivos bajo `app/api/finance` exponen las 26 operaciones descritas en la sección 12.

### Servicios

- `buildFinancialPlanning.ts`: read model y proyección.
- `buildCreditLineMaturities.ts`: vencimientos reales y gaps legacy.
- `syncSupplierPaymentsForOrder.ts`: materialización depósito/balance.
- `supplierPaymentExecutionService.ts`: pago individual atómico.
- `supplierPaymentFinanceService.ts`: financiación separada de pago ya ejecutado.
- `purchasePaymentBatchService.ts`: validación de lote.
- `creditLineLedgerService.ts`: adaptador de RPC de crédito.
- `creditLine*Validation.ts`: payloads de amortización, regularización y previstos.
- `unlinkedObligationsService.ts`: lectura/mapeo.
- `unlinkedObligationsCommandsService.ts`: validación + comandos RPC.
- `unlinkedObligationsValidation.ts` y `unlinkedObligationsApiErrors.ts`: contrato HTTP.
- `syncCreditLineDueFromSupplierPayment.ts`: recomendación de fuente; el helper de escritura está marcado deprecated y no crea movimientos.

### Repositorios

- `financialPlanningRepository.ts`: ocho consultas paralelas del plan.
- `financeSupplierPaymentsRepository.ts`: órdenes/pagos y RPC sync/void.
- `supplierPaymentExecutionRepository.ts`: RPC atómica pago+financiación.
- `supplierPaymentFinanceRepository.ts`: RPC de financiación posterior.
- `purchasePaymentBatchRepository.ts`: candidatos, ejecución y detalle.
- `creditLineLedgerRepository.ts`: RPC de disposición/amortización/legacy.
- `creditLineMaturitiesRepository.ts`: lectura de grupos/líneas/caja.
- `creditLinePlannedMaturitiesRepository.ts`: lectura y tres RPC de previstos.
- `unlinkedObligationsRepository.ts`: tablas/vistas de obligaciones.
- `unlinkedObligationsCommandsRepository.ts`: siete RPC mutadoras.
- `unlinkedTreasuryRepository.ts`: RPC de compromisos seguros.

### Tipos y utilidades

Los contratos están en `types/planning.types.ts`, `supplierPayments.types.ts`, `supplierPaymentExecution.types.ts`, `supplierPaymentFinance.types.ts`, `purchasePaymentBatch.types.ts`, `creditLineLedger.types.ts`, `creditLineMaturities.types.ts`, `creditLinePlannedMaturities.types.ts` y `unlinkedObligations.types.ts`. Utilidades activas: `financeInputValidation`, `resolveSupplierPaymentDates`, `resolveSupplierPaymentActuals`, `validateSupplierPaymentPlanBase`, `creditLineStatus`, `creditLineLegacyDates`, `creditLinePlannedRelease`, `legacySupplierPaymentSettlement`, `partitionFinanceEventsByDate`, `purchasePaymentSelection`, `resolveOrderLogisticsType` y `logisticsLabels`.

### Tests, SQL, diagnósticos y datos

- 11 archivos Node bajo `modules/finance/**/*test.mjs`.
- 36 migraciones seleccionadas por nombre financiero bajo `sql/migrations`.
- 15 diagnósticos financieros bajo `sql/diagnostics`.
- `sql/data/20260804_credit_line_planned_maturities.sql`: 33 filas idempotentes.
- SQL históricos de smoke en `C:\ERP_BACKUP` se describen en la sección 18.

## 4. Modelo de datos real

Todos los conteos son exactos para la consulta local del 06/08/2026. Tipos/PK/FK/checks proceden de `information_schema` y `pg_constraint`.

| Tabla | Finalidad y campos principales | PK/FK/índices/constraints relevantes | Escritura / lectura | Filas |
|---|---|---|---|---:|
| `finance_amazon_income_forecasts` | `forecast_date`, `description`, `amount_eur`, `status` | PK `id`; índice por fecha; sin FK | origen de escritura no conectado; plan lee | 0 |
| `finance_cash_accounts` | `name`, `balance`, `currency`, `status` | PK `id`; nombre único; balance actualizado por RPC | RPC de pagos/amortizaciones escribe; plan/candidatos leen | 1 |
| `finance_cash_movements` | ledger: cuenta, tipo, dirección, importe, fuente, fecha | PK; FK cuenta `CASCADE`; índices cuenta/fecha/fuente/tipo; unique de pago proveedor | RPC escribe; vencimientos/obligaciones leen | 0 |
| `finance_credit_lines` | banco/línea, límite, disponible, usado, ciclo, vencimiento, prioridad, status | PK; unique banco+línea; checks monetarios efectivos | RPC actualiza; plan/vencimientos/candidatos leen | 3 |
| `finance_credit_line_movements` | drawdown/repayment, importe, fuente, grupo, idempotencia | PK; FK línea `CASCADE`, grupo/caja; varios unique de fuente/idempotencia | RPC crédito escribe; plan/ledger lee | 0 |
| `finance_credit_line_repayment_groups` | periodo, vencimiento, total/pagado/restante, origen | PK; FK línea `CASCADE`; índices línea/fecha/status; unique por periodo/origen | drawdown/regularización/amortización escriben; plan lee | 0 |
| `finance_credit_line_repayments` | asiento inmutable con principal/interés/fees y snapshots | PK; FK línea/grupo/caja/movimientos; unique idempotencia y movimientos | RPC v2 escribe; lectura de detalle/diagnóstico | 0 |
| `finance_credit_line_planned_maturities` | principal/interés/fees previstos, fecha, source key, vínculos reales | PK; FK línea/grupo/repayment `RESTRICT`; unique `source_key`; índices línea/status-fecha | RPC create/update/cancel; plan/UI leen | 33 |
| `finance_credit_line_legacy_regularizations` | gap, total declarado, fingerprint, idempotencia, status | PK; FK línea; unique idempotencia | RPC v2 escribe; maturities lee | 0 |
| `finance_credit_line_legacy_regularization_items` | desglose principal/fechas y enlaces a grupo/movimiento | PK; cuatro FK; unique movimiento | RPC v2 escribe; maturities lee | 0 |
| `finance_supplier_payments` | obligación depósito/balance, plan/actual, FX, fees, fuente y estado | PK; FK orden `CASCADE`, contenedor/caja/línea `SET NULL`; unique orden+tipo duplicado por dos nombres; checks status/fuente/importes | sync y RPC de pago escriben; plan/logística leen | 62 |
| `finance_purchase_payment_batches` | cabecera de transferencia agrupada, payee, moneda, FX, fees, fuente y ledger | PK; FK agente/proveedor/caja/línea/grupo/movimientos; unique idempotencia; checks de fuente/importe/status | RPC lote escribe; APIs detalle/plan leen | 0 |
| `finance_purchase_payment_allocations` | imputación lote-obligación y pendientes antes/después | PK; FK batch/payment `RESTRICT`; unique par; checks importes/status | RPC lote escribe; plan/detalle lee | 0 |
| `finance_settings` | `key`, `value`, `updated_at` | PK `key` | origen de escritura no conectado; plan lee FX global | 1 |
| `finance_unlinked_obligation_templates` | recurrencia, categoría, importes, anclas y status | PK; FK creador; checks categoría/frecuencia/anclas/importes | RPC templates; APIs leen | 0 |
| `finance_unlinked_obligations` | obligación one-off/ocurrencia, lifecycle, importes/cancelación | PK; FK template y usuarios; unique template+periodo; checks origen/cancelación | RPC obligaciones; APIs/vistas leen | 0 |
| `finance_unlinked_obligation_installments` | plan revisionado de cuotas | PK; FK obligación/autorreferencia/usuario; unique secuencia; checks importes/status | RPC plan; vistas/API leen | 0 |
| `finance_unlinked_obligation_payments` | pago real total/detallado, fuente, ledger e idempotencia | PK; FK obligación/caja/línea/grupo/movimientos/usuario; unique idempotencia y movimientos | **No hay endpoint de pago conectado observado**; estructura/RPC auxiliares existen | 0 |
| `finance_unlinked_obligation_payment_allocations` | imputación pago-cuota | PK; FK pago/cuota; unique par; checks desglose | escritura no conectada observada; vistas leen | 0 |

Tablas externas usadas directamente:

| Tabla | Uso financiero | Relación/campos | Filas |
|---|---|---|---:|
| `ordenes_compra` | origen de obligaciones | moneda, depósito, fechas, estado; FK desde supplier payment | 47 |
| `orden_items` | total de compra | cantidad y coste unitario moneda | 152 |
| `contenedores` | costes/fechas logísticos | flete, tránsito, llegada, ETA, FX | 11 |
| `contenedor_ordenes` | enlace orden-contenedor | consulta anidada del plan | 11 |
| `agentes_compra` | beneficiario/contacto | FK desde batches y orden | 3 |
| `proveedores` | beneficiario del lote | FK desde batches | 13 |
| `auth.users` | autoría/autorización | FK `created_by/cancelled_by` | 2 |
| `fx_rates_daily` | tabla existente; repositorio financiero vacío | uso activo no confirmado | 0 |

## 5. Vistas, funciones, RPC y triggers

### Vistas efectivas

- `finance_unlinked_installment_balances`: agrega asignaciones de pagos `posted`; deriva `allocated_*`, `outstanding_total_eur`, `financial_status` (`pending/partial/paid/cancelled/superseded`) y condición temporal (`current/due_soon/overdue`).
- `finance_unlinked_obligation_balances`: agrega la vista anterior por obligación y deriva totales, status financiero, vencido y próxima fecha.

Definiciones efectivas: `pg_views`; origen: `sql/migrations/20260803_05_unlinked_obligation_read_models.sql`.

### RPC llamadas por el código

| Firma efectiva | Retorno | Lectura/escritura principal | Validación, lock e idempotencia | Consumidor |
|---|---|---|---|---|
| `sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean)` | fila/resultado plan | orden y `finance_supplier_payments` | wrapper autorizado; valida status/tipo; lock de orden en impl efectiva | `financeSupplierPaymentsRepository` |
| `void_pending_supplier_payment_plan(uuid)` | resultado | actualiza planes pendientes/vencidos | no altera ejecutados | mismo repositorio |
| `mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date)` | jsonb | payment + caja o crédito | wrapper `SECURITY DEFINER`; locks; fuente obligatoria; idempotencia | `supplierPaymentExecutionRepository` |
| `finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text)` | jsonb | financia payment ya pagado | wrapper + `phase1a_impl`; actual EUR + fees; idempotencia | `supplierPaymentFinanceRepository` |
| `get_purchase_payment_candidates(text)` | set de candidatos | payments/órdenes/agentes | lectura estable | modal lote |
| `create_and_apply_purchase_payment_batch(jsonb)` | jsonb | batch, allocations, payments y caja/crédito | wrapper autorizado; locks, fingerprint/idempotency | API batches |
| `get_purchase_payment_batch_detail(uuid)` | record/json | batch + allocations | lectura | modal detalle |
| `finance_create_credit_line_drawdown(uuid,numeric,date,text,uuid,text,text,date)` | jsonb | línea, movement, repayment group | `SECURITY DEFINER`; lock de identidad/línea; source/idempotency; fecha manual si no ciclo | ledger y RPC de financiación |
| `finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)` | jsonb | wrapper de amortización legacy | solo service role en ACL; delega a impl | helper legacy, no ruta UI v2 |
| `finance_create_credit_line_repayment_v2(uuid,uuid,uuid,numeric,numeric,numeric,date,text,text,text)` | jsonb | repayment, caja, movement, línea y grupo | wrapper autorizado; lock; fingerprint/idempotency; componentes y snapshots | `/repay` |
| `finance_register_legacy_opening_balance_v2(uuid,jsonb,text)` | jsonb | regularization/items/groups/movements | lock; desglose=gaps; idempotency/fingerprint | `/legacy-opening-balance` |
| `finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text)` | fila | planned maturities/línea | `pg_advisory_xact_lock(source_key)`; idempotencia por source key | previstos POST |
| `finance_update_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text)` | fila | planned maturity | solo `planned` no vinculado | previstos PATCH |
| `finance_cancel_credit_line_planned_maturity(uuid)` | fila | status/cancelled_at | solo `planned` no vinculado | previstos cancel |
| `finance_create_unlinked_obligation(jsonb)` | objeto | obligación + cuotas | actor admin/accounting; validación de desglose | API POST |
| `finance_update_pending_unlinked_obligation(uuid,jsonb)` | objeto | metadatos obligación | solo estado editable demostrado por RPC | API PATCH |
| `finance_replace_unpaid_installment_plan(uuid,jsonb)` | objeto | supersede/crea cuotas | no permite plan con asignaciones pagadas | API PUT |
| `finance_cancel_unlinked_obligation(uuid,text)` | fila | obligación/cuotas | razón obligatoria; sin allocations | API cancel |
| `finance_create_unlinked_obligation_template(jsonb)` | objeto | template | frecuencia/anclas/importes | API POST template |
| `finance_update_unlinked_obligation_template(uuid,jsonb)` | objeto | template | validación payload | API PATCH template |
| `finance_generate_unlinked_obligation_occurrences(uuid,date)` | jsonb | crea ocurrencias/cuotas | unique template+periodo evita repetición | API generate |
| `finance_list_unlinked_treasury_commitments(date,date)` | set seguro | vistas/obligaciones | lectura treasury | API treasury |

Errores exactos se traducen en los servicios. Familias observadas: `INVALID_*`, `NOT_FOUND`, `ADMIN_OR_ACCOUNTING_REQUIRED`, `UNAUTHENTICATED`, `IDEMPOTENCY_PAYLOAD_MISMATCH`, `INSUFFICIENT_CASH`, `INSUFFICIENT_CREDIT`, `GROUP_*`, `ALREADY_FINANCED`, `LEGACY_MANUAL_PAYMENT`, `PLANNED_MATURITY_IMMUTABLE` y errores específicos `OBLIGATION_*`. Evidencia: definiciones efectivas de `pg_proc`, `supplierPayment*Service.ts`, `purchasePaymentBatchService.ts`, `creditLineLedgerService.ts`, `unlinkedObligationsApiErrors.ts`.

Las versiones efectivas se redefinen al final de las cadenas `20260722`, `20260728`–`20260805`; wrappers/impl aparecen en `20260804_01_credit_line_authorization_and_read_safety.sql` y `20260805_01_supplier_payment_financing_actuals.sql`.

### Helpers/implementaciones SQL

Existen además `finance_app_role`, tres `finance_can_*`, `finance_assert_finite_money`, `finance_is_finite_numeric`, `finance_assert_unlinked_actor`, validadores/insertores internos de unlinked, cinco implementaciones `*_phase1a_impl` y funciones trigger. No son llamadas directamente por UI; son dependencias de las RPC anteriores.

### Triggers efectivos

Nueve triggers distintos generan 21 eventos:

- `trg_require_real_funding_on_supplier_payment_paid`: BEFORE INSERT/UPDATE de supplier payments.
- `finance_credit_line_movements_no_legacy_drawdown`: BEFORE INSERT/UPDATE.
- `finance_credit_line_repayments_immutable`: BEFORE UPDATE/DELETE.
- `finance_credit_line_legacy_regularizations_immutable`: BEFORE UPDATE/DELETE.
- `finance_credit_line_legacy_items_immutable`: BEFORE UPDATE/DELETE.
- `finance_unlinked_obligation_requires_installment`: AFTER INSERT/UPDATE, deferred.
- `finance_unlinked_installment_delete_guard`: AFTER INSERT/UPDATE/DELETE, deferred.
- `finance_unlinked_payment_allocation_integrity`: AFTER INSERT/UPDATE/DELETE, deferred.
- `finance_unlinked_allocation_integrity`: AFTER INSERT/UPDATE/DELETE, deferred.

## 6. Flujo de pagos a proveedor

1. `syncSupplierPaymentsForOrder(orderId)` carga orden/items/contenedor (`syncSupplierPaymentsForOrder.ts:88`).
2. `deposito_porcentaje` usa el valor de orden o 30 si es null; balance es `100-deposit`. Total original = suma `cantidad * coste_unitario_moneda` (`validateSupplierPaymentPlanBase.ts`).
3. Fecha depósito = fecha de orden; fecha balance se resuelve desde `fecha_pago_balance` o ETA menos días (`resolveSupplierPaymentDates.ts`).
4. Se llama dos veces a `sync_supplier_payment_plan`, tipos persistidos `DEPOSITO_30` y `BALANCE_70`; el enum permanece fijo aunque la etiqueta UI muestra el porcentaje real (`supplierPayments.types.ts`).
5. Confirmación de orden y vinculación de contenedor llaman a esta sincronización (`app/api/orders/[id]/confirm/route.ts`, `app/api/containers/[id]/orders/route.ts`).
6. El pago individual introduce `actualAmountOriginal`, `paidAt`, FX/fees/fuente. `normalizeMarkSupplierPaymentPaidInput` valida importes, UUID, fecha, moneda y fuente.
7. `mark_and_finance_supplier_payment` registra actual original/EUR/FX, fees separadas y financia desde caja o línea en la misma llamada. Para caja crea cash movement y reduce balance; para línea crea drawdown/grupo y reduce disponible/aumenta usado.
8. Pago por lote selecciona obligaciones homogéneas por beneficiario/moneda, acepta modo `selected_payments` o `free_amount`, crea batch y allocations, y actualiza estados `parcial/pagado`.
9. La planificación calcula pagado/pendiente desde allocations activas; si no existen usa actuals de la fila. Un payment legacy `manual` se muestra read-only.

FX: `actual_amount_eur = actual_amount_original * actual_fx_rate` según validadores/RPC; EUR usa tasa 1. `funded_total_eur` incorpora `actual_amount_eur + bank_fee_eur + ff_fee_eur` en pagos de proveedor/lotes. El plan conserva `planned_fx_rate` por separado.

## 7. Flujo de líneas de crédito

Las líneas se leen desde `finance_credit_lines`; no se observó endpoint financiero de creación/edición de cabecera. Límite, usado y disponible son columnas persistidas.

- **Disposición:** `finance_create_credit_line_drawdown`; aumenta usado, reduce disponible, crea `finance_credit_line_movements` y un `repayment_group`. Fecha de vencimiento usa `manual_due_date` o `cycle_days`.
- **Amortización:** UI `/repay` envía grupo, cuenta, principal, interés, fees, fecha, referencia e idempotencia. RPC v2 reduce principal usado, aumenta disponible, reduce caja, actualiza grupo y crea repayment/movimientos/snapshots.
- **Vencimiento real:** grupo con `amount`, `paid_amount`, `remaining_amount`, `due_date`; `buildCreditLineMaturities` deriva visual status y resúmenes 7/15 días/mes.
- **Previsto:** registro separado; principal libera crédito solo en proyección. No ejecuta ledger. Puede quedar vinculado a repayment/grupo.
- **Legacy:** la UI calcula gap entre usado y principal explicado; RPC v2 crea cabecera/items/grupos/movimientos explicativos sin volver a sumar el saldo ya existente.
- **Relación con pagos:** pago proveedor/lote desde línea crea drawdown cuyo `source_type/source_id` identifica payment o batch.

No se observó operación de refinanciación explícita línea-a-línea ni endpoint de alta/baja de línea. Marcado **implementado: ausente en las superficies inspeccionadas**.

## 8. Flujo de caja

`finance_cash_accounts.balance` alimenta el resumen del plan. Un movimiento contiene dirección `in/out`, tipo, importe, fecha y fuente. Se crea dentro de RPC al:

- financiar un supplier payment desde caja;
- ejecutar un lote desde caja;
- amortizar línea desde caja;
- pagar una obligación no vinculada, si se usa la estructura/RPC correspondiente (flujo HTTP de pago no verificado).

Movimientos y saldos se bloquean/actualizan dentro de la misma transacción SQL. El plan suma los balances actuales; proyecta salidas futuras recomendadas a caja y entradas Amazon. Repositorios: `financialPlanningRepository.ts`, `creditLineMaturitiesRepository.ts`; objetos: `finance_cash_accounts`, `finance_cash_movements`.

## 9. Obligaciones no vinculadas

- Templates: recurrencia mensual con intervalo 1/3/12, fecha inicial/final, anclas, importes y estado.
- Generación: crea ocurrencias por periodo hasta `throughDate`; unique `(template_id, occurrence_period)`.
- Obligación: one-off o recurring occurrence, metadatos, lifecycle y desglose total/detallado.
- Cuotas: revisiones y secuencias; reemplazo supersede cuotas anteriores no pagadas.
- Pagos/asignaciones: tablas y vistas soportan total/detallado, fuente caja/crédito e imputación por cuota.
- Lectura: servicios consultan tablas/vistas; treasury usa RPC de columnas seguras.
- Escritura conectada: siete APIs RPC para crear/editar/cancelar/generar. No se encontró endpoint conectado para registrar `finance_unlinked_obligation_payments`; marcado **no verificado**.

Archivos: `unlinkedObligations*.ts`, rutas `app/api/finance/unlinked-*`, migraciones `20260803_01`–`06`.

## 10. Ingresos Amazon

Implementado: el plan lee `finance_amazon_income_forecasts` dentro del horizonte y crea evento `amazon_income` con moneda EUR, status `previsto` e importe `amount_eur` (`financialPlanningRepository.ts`, `buildFinancialPlanning.ts`). La tabla local está vacía.

Origen de escritura: **no verificado**; no existe endpoint/UI financiero conectado. Liquidaciones reales, conciliación y cash movements derivados: **no implementados en las superficies financieras inspeccionadas**. Las tablas Amazon externas no son consultadas por `buildFinancialPlanning`.

## 11. Motor de planificación financiera

Entrada: `FinancePlanningQuery {fromMonth?, months?}`; API acepta `months` 1–24 y mes `YYYY-MM` (`app/api/finance/planning/route.ts`).

Consultas paralelas (`financialPlanningRepository.ts`): contenedores, supplier payments+allocations, líneas, repayment groups abiertos, planned maturities no vinculados, cash accounts, Amazon forecasts y setting `planned_usd_eur_rate`.

Eventos generados (`planning.types.ts`): supplier deposit/balance/settlement, freight/arrival/transit/bank fee, credit maturity/planned maturity/release y Amazon income.

Pseudocódigo fiel:

```text
raw = leer 8 conjuntos
normalizar líneas; activas admiten nuevas recomendaciones
cash = suma(balance cuentas)
creditAvailable = suma(disponible líneas activas)
eventos = pagos proveedor pendientes + settlements reales/legacy
        + costes contenedor
        + grupos de repayment
        + vencimientos previstos
        + eventos informativos de liberación
        + forecasts Amazon
separar eventos sin fecha
por cada mes cronológico:
  ordenar por fecha
  para cada evento no informativo:
    Amazon -> cash += ingreso
    vencimiento real -> cash -= restante; liberar principal limitado
    previsto -> cash -= principal+interés+fees; liberar principal limitado
    supplier/logística pendiente recomendado cash -> cash -= EUR efectivo
    supplier/logística pendiente recomendado línea -> creditAvailable -= EUR
    evento ya pagado -> no volver a proyectar salida
  calcular totales y snapshots proyectados del mes
devolver summary, líneas, cuentas, months y pendingDateEvents
```

Recomendación: usa caja si cubre importe; si no, primera línea activa por prioridad/disponibilidad (`syncCreditLineDueFromSupplierPayment.ts`). Es una recomendación de visualización; la ejecución exige selección de fuente.

Fallback legacy: pagos sin allocations pueden usar `actual_amount_*`; pagados antiguos pueden usar `amount_original`; `payment_source_type=manual` no se ofrece para operar; `legacySupplierPaymentSettlement` crea evento histórico separado.

Fechas: eventos sin fecha se separan; status pasado se vuelve `vencido`; buckets comienzan en mes pedido o actual. Monedas: original se conserva; planned EUR usa planned FX/relación proporcional; actual EUR usa allocations/actuals.

Respuesta: `FinancePlanningResponse` con summary, creditLines, cashAccounts, buckets y pendientes sin fecha.

## 12. APIs financieras

Roles: `T` = treasury (`admin/accounting/logistics`); `D` = detalles/gestión (`admin/accounting`); `A` = cualquier usuario autenticado en dos endpoints legacy de lectura.

| Método y ruta | Entrada/validación | Servicio/RPC/tablas | Respuesta/efecto | Rol |
|---|---|---|---|---|
| GET `/api/finance/planning` | `fromMonth`, `months` | `buildFinancialPlanning` | plan JSON, read-only | T |
| GET `/credit-lines/maturities` | status/from/to/line UUID | `buildCreditLineMaturities` | maturities, summary, gaps, permissions | T |
| POST `/credit-lines/{id}/repay` | componentes, cuenta, grupo, fecha, key | ledger service / repayment v2 | asiento y saldos | D |
| POST `/credit-lines/{id}/legacy-opening-balance` | dispositions + key | legacy validation/RPC v2 | regularización | D |
| GET `/credit-lines/planned-maturities` | filtros fecha/línea/status | tabla | filas + canManage | T |
| POST `/credit-lines/planned-maturities` | principal/interés/fees/concept/key | create planned RPC | fila | D |
| PATCH `/credit-lines/planned-maturities/{id}` | mismos campos sin key | update planned RPC | fila | D |
| POST `/credit-lines/planned-maturities/{id}/cancel` | UUID | cancel RPC | fila cancelada | D |
| PATCH `/supplier-payments/{id}/mark-paid` | actual original, FX/fees/fuente | execution service / atomic RPC | payment+financing | D |
| POST `/supplier-payments/{id}/finance` | fuente/fecha/targets/key | finance service/RPC | financiación posterior | D |
| POST `/supplier-payments/backfill` | sin body; guard local host | sync service | conteos sync | auth + bloqueo por host |
| GET `/purchase-payment-candidates` | `q` | candidates RPC + cuentas/líneas | candidatos/maestros | A |
| POST `/purchase-payment-batches` | payee, allocations/importes, FX/fees/fuente | batch service/RPC | batch+allocations | D |
| GET `/purchase-payment-batches/{id}` | UUID implícito | detail RPC | detalle | A |
| GET `/unlinked-obligations` | filtros/search/page | read service | lista | D |
| POST `/unlinked-obligations` | payload validado | create RPC | 201 + objeto | D |
| GET `/unlinked-obligations/{id}` | id | read service | detalle | D |
| PATCH `/unlinked-obligations/{id}` | metadata | update RPC | objeto | D |
| PUT `/unlinked-obligations/{id}/installment-plan` | breakdown+installments | replace RPC | objeto | D |
| POST `/unlinked-obligations/{id}/cancel` | reason | cancel RPC | objeto | D |
| GET `/unlinked-obligation-templates` | filtros | read service | lista | D |
| POST `/unlinked-obligation-templates` | template | create RPC | 201 + objeto | D |
| GET `/unlinked-obligation-templates/{id}` | id | read service | detalle | D |
| PATCH `/unlinked-obligation-templates/{id}` | patch | update RPC | objeto | D |
| POST `/unlinked-obligation-templates/{id}/generate` | throughDate | generate RPC | resumen | D |
| GET `/treasury/unlinked-commitments` | dueFrom/dueTo | safe RPC | 13 campos seguros | T |

Errores comunes HTTP: 400 JSON/query, 401 no autenticado, 403 acceso, 404 no encontrado, 409 conflicto/idempotencia/estado, 422 validación, 500 interno. Mapeos exactos están en cada route y servicios de error.

## 13. UI actual

`FinancialPlanningPage` consume `/planning`, muestra filtros de mes/horizonte, KPIs de crédito/caja/pagos/ingresos, tarjetas de líneas/cuentas, buckets mensuales y eventos. Acciones:

- abrir pago individual en eventos operables;
- abrir creación de pago vinculado;
- abrir detalle de batch;
- cargar sección de vencimientos reales y amortizar;
- regularizar gap legacy si permisos;
- listar/registrar vencimientos previstos.

`PaymentModal` captura importe original, fecha, FX, fees, referencia, fuente y cuenta/línea; exige vencimiento manual si la línea no tiene `cycle_days`. `LinkedPurchasePaymentModal` selecciona obligaciones/órdenes, fuente y allocations. `CreditLineRepaymentModal` captura componentes. La UI de previstos calcula “salida prevista” como suma de tres campos.

No se renderizan los componentes vacíos enumerados en sección 19. No se encontró UI de obligaciones no vinculadas ni ingresos Amazon.

## 14. Autorización, RLS y grants

Roles TypeScript (`server/auth/adminAuthorization.ts`): `admin`, `accounting`, `logistics`. Treasury: los tres; detalle/gestión: admin/accounting. Se deriva de `user.app_metadata.role`.

Las 19 tablas `finance_*` tienen RLS activo, no forzado. Políticas:

- SELECT treasury: líneas, caja, repayment groups, repayments, regularizaciones y planned maturities mediante `finance_can_read_treasury`.
- batches/allocations: SELECT authenticated `true`.
- supplier payments: SELECT/INSERT/UPDATE authenticated `true`; grants directos actuales dejan SELECT/REFERENCES/TRIGGER/TRUNCATE para authenticated.
- unlinked: SELECT mediante `finance_can_read_unlinked_details`.
- sin policy: Amazon forecasts, cash movements, credit line movements y settings.

Las dos vistas no tienen RLS propio; sus lecturas se condicionan por grants/definición. Grants efectivos están documentados en catálogo; `service_role` conserva CRUD amplio. Operaciones financieras persistentes conectadas usan RPC `SECURITY DEFINER`; implementaciones `phase1a_impl` no otorgan EXECUTE a roles de API. Excepciones exactas: algunos helpers públicos tienen EXECUTE amplio y el wrapper drawdown solo service role.

## 15. Estados y transiciones

| Entidad | Estados efectivos | Transición observada |
|---|---|---|
| supplier payment | `pendiente`, `parcial`, `pagado`, `vencido` | sync crea pendiente/vencido; allocations/pago llevan a parcial/pagado; fecha pasada se representa vencida |
| payment source | null, `cash_account`, `credit_line`, legacy `manual` | RPC asigna fuente real; manual solo lectura |
| batch | `posted`, `reversed` según checks/código | create deja posted; reversión no tiene endpoint conectado observado |
| credit line | `activa/activo/active` y variantes inactiva/eliminada manejadas por util | creación no conectada; drawdown exige activa; repayment permite deuda de no eliminada según RPC |
| repayment group | `open`, `partially_paid`, `paid`, `cancelled` | drawdown crea open; repayment actualiza paid_amount/restante/status |
| repayment/regularization | `posted`, posible `reversed` en repayment | RPC crea posted; filas protegidas contra update/delete directo |
| planned maturity | `planned`, `cancelled`, `paid` contemplado | create planned; cancel; vinculación real puede hacerla inmutable; transición de enlace no verificada por flujo UI |
| unlinked obligation | `active`, `cancelled` | create active; cancel exige razón |
| installment | `active`, `cancelled`, `superseded` | replace supersede no pagadas; cancel acompaña obligación |
| unlinked payment | `posted`, `reversed` | estructura SQL; flujo de creación no conectado/no verificado |
| template | `active`, `paused`, `ended`, `cancelled` | create/update RPC; transiciones exactas dependen del payload |
| Amazon forecast | default `previsto` | no hay mutación conectada observada |

## 16. Cálculos monetarios y FX

PostgreSQL usa `numeric`; varias tablas nuevas fijan escalas `numeric(14,2)` para EUR y `numeric(14,4)` para importes originales. Tablas históricas conservan `numeric` sin typmod en algunos campos.

- Plan proveedor original: suma items y aplica porcentaje; TS.
- Planned EUR: `amount_original * planned_fx_rate`; sync/TS-RPC.
- Actual EUR individual: original × actual FX, validado/redondeado por servicio/RPC.
- Fees: `bank_fee_eur` y `ff_fee_eur` separadas; funded total suma actual EUR y fees.
- Lote: allocations originales/EUR y weighted FX en planificación.
- Repayment: total cash out = principal + interest + fees; SQL y preview UI.
- Unlinked detailed: total = principal + interest + other fees; constraints SQL.
- Proyección: sumas/restas Number en `buildFinancialPlanning.ts`.
- UI: previews, validación de dos decimales y formateo EUR/original; no persiste por sí sola.

Monedas observadas en contratos: códigos text; supplier/original se normaliza uppercase; EUR tiene tasa 1. `planned_usd_eur_rate` existe con valor null local. `fx_rates_daily` está vacío y su repositorio/servicio financiero están vacíos.

## 17. Datos locales actuales

| Dataset | Filas/estado |
|---|---|
| cash accounts | 1 |
| credit lines | 3, todas `activa` |
| supplier payments | 62: 33 pendiente, 27 vencido, 2 pagado; fuente real null en las 62 |
| planned maturities | 33, todas `planned`/`spreadsheet_schedule` |
| cash movements | 0 |
| credit movements/groups/repayments | 0/0/0 |
| regularizaciones/items | 0/0 |
| batches/allocations | 0/0 |
| Amazon forecasts | 0 |
| unlinked templates/obligations/installments/payments/allocations | 0 en todas |
| settings | 1: `planned_usd_eur_rate` sin valor |

Fixture: `sql/data/20260804_credit_line_planned_maturities.sql`, 17 Caja Rural, 7 La Caixa y 9 BBVA. No se incluyen nombres personales ni secretos.

## 18. Pruebas existentes

### Node

11 archivos, 53 declaraciones `test(...)` más un archivo con runner propio. Ejecución observada en auditoría: 20 unidades reportadas, 15 pass/5 fail; las cinco fallan al importar parameter properties TS con Node 24 strip-only.

| Archivo | Cobertura |
|---|---|
| `unlinkedFinanceRepositories.test.mjs` | RPC-only y columnas treasury |
| `creditLineAuthorization.test.mjs` | capacidades y rutas |
| `creditLineLegacyRegularization.test.mjs` | validación/RPC/migración/UI legacy |
| `creditLinePlannedMaturities.test.mjs` | validación, UI, locking y data |
| `creditLineRepaymentUiContract.test.mjs` | payload v2 en consumidores |
| `creditLineRepaymentValidation.test.mjs` | componentes y traducción errores |
| `financialPlanningReadOnly.test.mjs` | GET sin sincronización/escritura |
| `supplierPaymentFinancingActualsMigration.test.mjs` | impl actual EUR+fees |
| `unlinkedObligationsApiErrors.test.mjs` | errores HTTP |
| `unlinkedObligationsService.test.mjs` | lectura/mapeo |
| `unlinkedObligationsValidation.test.mjs` | payloads/query |

### SQL del proyecto

15 diagnósticos. Transaccionales con rollback: autorización, legacy, planned maturities, repayment components, actual FX y sync concurrency. Resultado observado: planned, legacy y repayment components pasan; autorización falla por `permission denied` antes del mensaje esperado; actual FX y sync fallan por fixture sin par depósito/balance. Los restantes son consultas/preflight read-only.

### Smoke históricos en `C:\ERP_BACKUP`

- cuatro smoke SQL individuales/vinculados: contienen DML dentro de `BEGIN...ROLLBACK`;
- `concurrency_test/concurrency.sql`: prueba de batch concurrente y termina en `COMMIT`;
- logs muestran revisiones fallidas y posteriores sin token de error. Su vigencia funcional actual está **no verificada**.

## 19. Código legado, vacío o no conectado

21 archivos vacíos bajo `modules/finance`:

- calculations: `acos.ts`, `cogs.ts`, `currency.ts`, `margin.ts`, `roi.ts`;
- components: `FinanceFilters.tsx`, `FinanceKpiCards.tsx`, `FinancePage.tsx`, `ProfitabilityTable.tsx`;
- hooks: `useFinanceDashboard.ts`, `useProfitability.ts`;
- mappers: `financeDashboardMapper.ts`, `profitabilityMapper.ts`;
- schemas: `fxSyncSchema.ts`, `profitabilityQuerySchema.ts`;
- repositories: `fxRatesRepository.ts`;
- services: `calculateFinancialSummary.ts`, `financeClient.ts`, `getFinanceDashboard.ts`, `getProfitability.ts`, `syncFxRates.ts`.

`financeRepository.ts` aparece eliminado en el working tree y no es requerido por TypeScript actual. Helpers legacy en `creditLineLedgerService.ts` (`findOrCreateOpenRepaymentGroup`, `createCashMovement`, repayment antiguo) no son usados por las rutas UI v2 demostradas. `/supplier-payments/{id}/finance` existe, mientras el PaymentModal usa `/mark-paid`; ambos están implementados, pero el primero no tiene consumidor UI encontrado.

## 20. Glosario real

- **supplier payment:** fila depósito/balance ligada a una orden.
- **payment batch:** transferencia única a agente/proveedor que aplica importe a una o varias obligaciones.
- **allocation:** reparto de un batch/pago sobre supplier payment o cuota.
- **cash movement:** asiento de entrada/salida ligado a cuenta y fuente.
- **credit line movement:** disposición o amortización del ledger de una línea.
- **repayment group:** deuda/vencimiento agregado creado por disposición o regularización.
- **planned maturity:** previsión no ejecutiva de principal/interés/fees de línea.
- **legacy regularization:** explicación inmutable del saldo usado previo sin movimientos canónicos.
- **unlinked obligation:** compromiso no originado por una orden de compra.
- **forecast:** ingreso Amazon manual previsto.
- **actual amount:** importe efectivamente pagado, original y/o EUR.
- **planned amount:** importe previsto antes de ejecución.
- **source key:** identidad estable de una previsión importada/manual.
- **idempotency key:** identidad de una operación mutadora; repetir mismo payload devuelve/reconoce la misma operación y payload distinto produce conflicto.

## 21. Matriz de trazabilidad

| Funcionalidad | UI | API | Servicio | Repositorio | RPC | Tablas | Tests |
|---|---|---|---|---|---|---|---|
| planificación | FinancialPlanningPage | `/planning` | buildFinancialPlanning | financialPlanningRepository | — | 8 fuentes | financialPlanningReadOnly |
| sync proveedor | indirecta por orden | backfill/orden | syncSupplierPaymentsForOrder | financeSupplierPaymentsRepository | sync/void plan | supplier payments, orders | SQL sync |
| pago individual | PaymentModal | mark-paid | supplierPaymentExecutionService | executionRepository | mark_and_finance | payment, caja/crédito | actual FX/migration |
| financiación posterior | no consumidor encontrado | finance | supplierPaymentFinanceService | financeRepository | finance_finance_supplier_payment | payment, caja/crédito | migration |
| lote | LinkedPurchasePaymentModal | candidates/batches | purchasePaymentBatchService | batchRepository | candidates/create/detail | batches, allocations, ledgers | UI selection + smoke histórico |
| vencimiento real | MaturitiesSection | maturities | buildCreditLineMaturities | maturitiesRepository | — | groups/lines | diagnostics |
| amortización | RepaymentModal | repay | ledgerService | ledgerRepository | repayment_v2 | repayment/group/cash/line | Node + SQL components |
| previsto | PlannedMaturitiesSection | planned-maturities | validation | plannedRepository | create/update/cancel | planned maturities | Node + SQL |
| legacy | Legacy modal | legacy-opening | validation/ledger | ledgerRepository | register_v2 | regularizations/items/groups | Node + SQL |
| unlinked lectura | no UI encontrada | unlinked GETs | unlinkedService | unlinkedRepository | treasury list | unlinked + vistas | Node repositories/service |
| unlinked comandos | no UI encontrada | unlinked mutators | commandsService | commandsRepository | 7 RPC | unlinked tables | Node validation/errors |
| Amazon forecast | eventos del calendario | planning | buildFinancialPlanning | planningRepository | — | forecasts | planning read-only |

## 22. Límites de la documentación

- No se ejecutaron flujos funcionales ni se crearon datos; comportamiento sin filas locales se documenta desde código/esquema.
- No se conectó a Supabase remoto; su estado no está verificado.
- No se verificó el origen de escritura de Amazon forecasts, settings, líneas o cuentas.
- No se encontró consumidor UI para obligaciones no vinculadas, financiación posterior o ingreso Amazon; consumidores externos al repositorio no están verificados.
- No se confirmó un flujo que cree pagos/asignaciones de obligaciones no vinculadas.
- No se restauraron dumps; su contenido detallado posterior al 31/07 no está verificado.
- Las cinco pruebas Node bloqueadas no validaron sus aserciones en el runtime actual.
- Estados sin filas locales (`partial`, `reversed`, etc.) están confirmados por constraints/código, no por ejemplos de datos.
- Las funciones históricas se describen según la definición efectiva del catálogo; no se atribuye un orden de aplicación no registrado.
