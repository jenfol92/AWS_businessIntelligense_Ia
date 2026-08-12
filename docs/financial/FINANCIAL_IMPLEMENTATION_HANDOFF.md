# Relevo de implementación financiera

**Fecha:** 2026-08-06
**Proyecto:** `C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA`
**PostgreSQL local:** `supabase_db_ERP_BACKUP`
**Supabase remoto:** no consultado ni modificado.

## 1. Objetivo implementado

Completar un flujo financiero local de extremo a extremo reutilizando el módulo existente:

- generación de depósito y balance al confirmar una orden;
- pago desde caja o línea de crédito;
- comisiones bancarias y financieras separadas;
- disposición, vencimiento y amortización de crédito;
- refinanciación explícita entre líneas;
- tesorería operativa asignada y reserva mínima;
- ingresos Amazon previstos, acumulados, confirmados y recibidos;
- proyección y clasificación explicable de tensión de tesorería;
- recomendación determinista de financiación, sin ejecución automática.

Shopify, SP-API settlements reales, fiscalidad, contabilidad general, conciliación bancaria completa y migración remota quedaron fuera del alcance.

## 2. Estado actual

- El flujo base está implementado en código, SQL, APIs y UI mínima.
- Las cuatro migraciones nuevas se aplicaron mediante `psql` exclusivamente a `supabase_db_ERP_BACKUP`.
- El fixture integral pasó y terminó con `ROLLBACK`.
- Typecheck, build y 73 pruebas Node pasaron.
- Las rutas nuevas compilaron y respondieron `401` sin sesión, confirmando el límite de autenticación.
- La validación visual autenticada y la carrera real con dos sesiones continúan pendientes.
- Ninguna cuenta bancaria existente fue marcada automáticamente como tesorería operativa.

El análisis previo está en `docs/financial/FINANCIAL_FLOW_GAP_ANALYSIS.md`.

## 3. Archivos creados

### Documentación

- `docs/financial/FINANCIAL_FLOW_GAP_ANALYSIS.md`
- `docs/financial/FINANCIAL_IMPLEMENTATION_HANDOFF.md`

### Migraciones y datos

- `sql/migrations/20260806_01_financial_operating_flow.sql`
- `sql/migrations/20260806_02_supplier_payment_execution_idempotency.sql`
- `sql/migrations/20260806_03_amazon_income_and_operating_account_rpcs.sql`
- `sql/migrations/20260806_04_fix_amazon_income_partial_unique_upsert.sql`
- `sql/data/financial_operating_flow_fixture.sql`
- `sql/data/financial_operating_flow_fixture_cleanup.sql`

### Backend y tipos

- `modules/finance/types/operatingFlow.types.ts`
- `modules/finance/repositories/operatingFlowRepository.ts`
- `modules/finance/services/operatingFlowService.ts`
- `modules/finance/services/treasuryEngine.ts`

### APIs

- `app/api/finance/credit-lines/refinance/route.ts`
- `app/api/finance/treasury/operations/route.ts`
- `app/api/finance/treasury/accounts/[id]/operating/route.ts`
- `app/api/finance/amazon-income/route.ts`
- `app/api/finance/amazon-income/[id]/receive/route.ts`

### UI

- `modules/finance/components/CreditLineRefinancingModal.tsx`

### Pruebas

- `modules/finance/services/supplierPaymentFlowRules.test.mjs`
- `modules/finance/services/treasuryEngine.test.mjs`
- `modules/finance/services/operatingFlowContracts.test.mjs`

## 4. Archivos modificados

- `modules/finance/components/CreditLineMaturitiesSection.tsx`
- `modules/finance/components/FinancialPlanningPage.tsx`
- `modules/finance/repositories/supplierPaymentExecutionRepository.ts`
- `modules/finance/services/buildFinancialPlanning.ts`
- `modules/finance/services/supplierPaymentExecutionService.ts`
- `modules/finance/types/planning.types.ts`
- `modules/finance/types/supplierPaymentExecution.types.ts`

Compatibilidad del runner Node 24, sin cambio funcional:

- `modules/finance/types/creditLineLedger.types.ts`
- `modules/finance/services/creditLinePlannedMaturityValidation.ts`
- `modules/finance/services/unlinkedObligationsApiErrors.ts`

También estaban modificados antes de esta tarea y se conservaron:

- `modules/finance/repositories/financialPlanningRepository.ts`
- partes de `FinancialPlanningPage.tsx`, `buildFinancialPlanning.ts` y `planning.types.ts` relacionadas con vencimientos previstos;
- archivos `CreditLinePlannedMaturitiesSection`, repositorio, tipos, tests y utilidad de liberación prevista que ya estaban sin seguimiento.

## 5. Migraciones locales

Las siguientes migraciones se aplicaron solo a `supabase_db_ERP_BACKUP`:

1. `20260806_01_financial_operating_flow.sql`
2. `20260806_02_supplier_payment_execution_idempotency.sql`
3. `20260806_03_amazon_income_and_operating_account_rpcs.sql`
4. `20260806_04_fix_amazon_income_partial_unique_upsert.sql`

Se ejecutaron directamente con `psql -f`; no se ejecutó `supabase db reset` ni un comando de migración remota. Por ello, el esquema local contiene los objetos, pero no se confirmó que exista una entrada equivalente en una tabla de historial de migraciones de Supabase.

## 6. Esquema añadido

### Tablas

- `finance_operating_treasury_operations`
- `finance_credit_line_refinancings`
- `finance_supplier_payment_executions`

### Columnas

En `finance_cash_accounts`:

- `is_operating_treasury boolean NOT NULL DEFAULT false`

En `finance_amazon_income_forecasts`:

- `source_key`
- `marketplace`
- `cycle_start`
- `cycle_end`
- `estimated_gross_eur numeric(14,2)`
- `historical_net_ratio numeric(9,6)`
- `confirmed_amount_eur numeric(14,2)`
- `received_amount_eur numeric(14,2)`
- `received_at`
- `cash_account_id`
- `cash_movement_id`
- `idempotency_key`

El status admite `previsto` legacy, `projected`, `accumulated`, `confirmed` y `received`.

### RPC

- `finance_refinance_credit_line`
- `finance_record_operating_treasury_operation`
- `finance_receive_amazon_income`
- `finance_execute_supplier_payment`
- `finance_upsert_amazon_income`
- `finance_set_operating_cash_account`

### RLS y permisos

- RLS activado en las tres tablas nuevas.
- Políticas SELECT para `authenticated` mediante `finance_can_read_treasury()` o `finance_can_read_unlinked_details()`.
- DML directo revocado a `authenticated`; las operaciones se realizan mediante RPC `SECURITY DEFINER`.
- Ejecución concedida a `authenticated` y `service_role`.

## 7. Endpoints

- `POST /api/finance/credit-lines/refinance`
- `POST /api/finance/treasury/operations`
- `PATCH /api/finance/treasury/accounts/[id]/operating`
- `POST /api/finance/amazon-income`
- `POST /api/finance/amazon-income/[id]/receive`

Todos exigen `requireFinanceDetailsAccess`.

El endpoint existente `PATCH /api/finance/supplier-payments/[id]/mark-paid` utiliza ahora `finance_execute_supplier_payment` y requiere una idempotency key.

## 8. UI

En la sección de vencimientos se añadió:

- botón `Refinanciar`;
- selección de línea financiadora;
- principal, intereses y comisiones separados;
- fecha manual para líneas sin `cycle_days`;
- preview de nueva disposición y principal liberado;
- confirmación y mensaje con el nuevo vencimiento.

En planificación se muestran:

- caja operativa real;
- reserva y caja disponible sobre reserva;
- estado de tesorería;
- recomendación explicable.

## 9. Reglas implementadas

- Depósito en fecha de confirmación, con fallback a fecha de orden.
- AGL: balance en ETD/fecha de salida AGL.
- Transporte propio: balance en ETA menos días configurados.
- Porcentaje configurado de la orden conservado; fallback 30/70.
- Coste total del pago: importe real EUR + comisión bancaria + gasto financiero.
- Caja y crédito se modifican solo por operaciones reales.
- Caja Rural usa 120 días; CaixaBank/La Caixa 90; línea sin ciclo exige fecha manual.
- Solo el principal amortizado libera crédito.
- Refinanciación crea nueva deuda por principal + intereses + comisiones y libera únicamente el principal origen.
- Las dos líneas se bloquean por UUID en orden determinista.
- Reserva inicial: `minimum_operating_cash_reserve_eur = 20000`.
- `projected`, `accumulated` y `confirmed` no crean caja.
- `received` crea exactamente un movimiento de entrada e incrementa caja operativa.
- Estados del motor: `healthy`, `watch`, `stress`, `high_stress`, `critical`.
- La recomendación respeta reserva, prioridad, vencimiento posterior al próximo ingreso y fecha manual.

## 10. Fixture y conciliación exacta

El fixture creó dentro de una transacción:

- una cuenta operativa;
- Caja Rural 120, CaixaBank 90 y BBVA manual;
- proveedor, agente, orden AGL y orden propia;
- cuatro obligaciones;
- pago desde caja y desde crédito;
- amortización y refinanciación;
- dos previsiones Amazon, un confirmado y un recibido.

Resultado antes del `ROLLBACK`:

```text
Caja inicial aportada             120.000,00
Amazon recibido                     9.000,00
Pago proveedor desde caja          -2.735,00
Amortización total                 -1.150,00
Caja final                         125.115,00

CaixaBank dispuesto                 4.550,00
Principal amortizado               -1.000,00
Principal refinanciado             -2.000,00
CaixaBank usado final               1.550,00

BBVA principal refinanciado         2.000,00
Intereses financiados                 100,00
Comisiones financiadas                 25,00
BBVA usado final                    2.125,00
```

Resultado SQL: `FINFLOW_FIXTURE_PASS`.

## 11. Pruebas ejecutadas

- `npx.cmd tsc --noEmit`: pasa.
- `npm.cmd run build`: pasa.
- Node financiero: 73 tests, 73 pasan, 0 fallan.
- Fixture SQL integral: pasa y ejecuta `ROLLBACK`.
- `credit_line_repayment_components_test.sql`: pasa con rollback.
- `credit_line_planned_maturities_test.sql`: pasa con rollback.
- Reintentos idempotentes de pago, Amazon received y refinanciación: pasan.
- BBVA sin fecha manual: rechazado con `MANUAL_DUE_DATE_REQUIRED`.
- HTTP local sin sesión: página redirige a autenticación y endpoints nuevos responden `401`.
- Build incluye las cinco rutas nuevas.

## 12. Errores encontrados y correcciones

1. Docker requería permiso para acceder a la tubería local. Se utilizaron únicamente comandos aprobados contra `supabase_db_ERP_BACKUP`.
2. El primer fixture no localizó el repayment group por una idempotency key supuesta. Se cambió a la relación real del movimiento drawdown.
3. `ON CONFLICT(source_key)` falló porque el índice era único parcial. Se sustituyó por advisory lock y `SELECT FOR UPDATE` seguido de `UPDATE` o `INSERT`; la corrección efectiva está en la migración 04.
4. Cinco pruebas Node fallaban por propiedades de parámetro TypeScript no soportadas por Node 24 en modo strip-only. Se transformaron mecánicamente en propiedades explícitas.
5. Una prueba de `high_stress` usaba un evento `outflow` en vez de `maturity`. Se corrigió el fixture unitario, no el motor.
6. El navegador integrado no estaba disponible; no se realizó validación visual autenticada.

Todos los fallos de fixture ocurrieron dentro de transacciones abortadas y no dejaron filas.

## 13. Estado persistido en PostgreSQL local

Persisten:

- objetos de las cuatro migraciones;
- `finance_settings.minimum_operating_cash_reserve_eur = 20000`;
- columnas, constraints, índices, RLS, políticas, grants y RPC descritos;
- `is_operating_treasury = false` para cuentas anteriores, porque no se reasignaron automáticamente.

No persisten datos del fixture. La consulta final observó cero filas sintéticas en órdenes, líneas, Amazon, refinanciaciones y ejecuciones con identificadores `FINFLOW_*`/`f1000000-*`.

## 14. Repositorio frente a Docker

- El repositorio contiene las cuatro migraciones.
- Docker contiene el resultado efectivo de las cuatro migraciones.
- La migración 03 del repositorio ya incorpora el upsert Amazon corregido para instalaciones nuevas.
- Docker recibió además la migración incremental 04 porque la versión inicial de la migración 03 ya había sido aplicada cuando se detectó el defecto.
- No se verificó registro de estas aplicaciones en el historial de migraciones de Supabase; se aplicaron con `psql`.
- `C:\ERP_BACKUP` y sus archivos no se modificaron.
- El volumen actual no se eliminó, recreó ni restauró.

## 15. Working tree previo y ajeno a finanzas

Antes de esta tarea ya había cambios no relacionados con finanzas. No se modificaron deliberadamente como parte de este flujo. Incluían:

- Amazon SP-API: configuración, clientes, scheduler, jobs, forecast/importación y nuevas rutas cron/diagnóstico;
- inventario e importadores Amazon FBA;
- contenedores y relaciones de órdenes;
- pedidos y edición de órdenes confirmadas;
- planificador y llegadas;
- filtros compartidos y sidebar;
- migraciones de costes de fábrica y operaciones de órdenes;
- documentación y scripts no financieros sin seguimiento.

El working tree ya era amplio y sucio; no debe asumirse que todos los cambios visibles pertenecen a esta implementación financiera.

## 16. Limitaciones pendientes

- Falta validación funcional manual y autenticada de la UI.
- Falta una prueba real de concurrencia con dos sesiones para refinanciación.
- `dblink` no está instalado en la base local; no se añadió la extensión.
- La idempotencia y los locks se probaron secuencialmente y mediante contratos estáticos, no bajo carrera real.
- No se asignó ninguna cuenta real existente como tesorería operativa.
- No se verificó un registro formal de las cuatro migraciones en el ledger de Supabase CLI.
- No se evaluó migración remota.

## 17. Riesgos antes de migrar

- Reconciliar el esquema Docker con el historial de migraciones para evitar aplicar dos veces objetos ya efectivos.
- Verificar grants y RLS con sesiones reales `admin`, `accounting` y `logistics`.
- Confirmar qué cuenta representa la tesorería operativa Amazon antes de activar el forecast real.
- Ejecutar refinanciación concurrente en dos sesiones y confirmar una sola operación persistida.
- Validar que el modal conserva la misma idempotency key durante reintentos del mismo payload.
- Revisar la convivencia de migraciones nuevas con los cambios financieros previos aún sin commit.
- No llevar datos `FINFLOW_*` ni valores locales de prueba a remoto.

## 18. Próximo paso mínimo

En una sesión nueva:

1. leer este relevo;
2. inspeccionar el estado Git sin modificarlo;
3. confirmar por catálogo que las cuatro migraciones siguen efectivas localmente;
4. probar la UI autenticada con una sesión financiera;
5. ejecutar una carrera de refinanciación en dos conexiones locales y comprobar idempotencia, locks y saldos;
6. detenerse sin añadir funcionalidad ni tocar remoto.

## Prompt de continuación

```text
Trabaja únicamente en el proyecto local C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA y en PostgreSQL local supabase_db_ERP_BACKUP. Lee primero docs/financial/FINANCIAL_IMPLEMENTATION_HANDOFF.md. Verifica el estado Git sin modificar cambios existentes y confirma que siguen aplicadas las cuatro migraciones 20260806_01 a 20260806_04. Ejecuta únicamente una validación funcional manual y autenticada de la UI financiera y una prueba de concurrencia de refinanciación mediante dos sesiones PostgreSQL locales, usando datos sintéticos reversibles. No añadas funcionalidades, no rediseñes, no ejecutes resets ni restauraciones y no accedas ni escribas en Supabase remoto. Entrega resultados exactos y detente.
```
