# Análisis de brecha del flujo financiero integral

**Fecha de contraste:** 2026-08-06
**Ámbito:** código local `ERP_BI_IA` y esquema efectivo del contenedor `supabase_db_ERP_BACKUP`.
**Estado de esta fase:** análisis previo a cambios funcionales.

## Convenciones

- **Implementada:** existe un recorrido conectado y una operación persistente o cálculo efectivo.
- **Parcialmente implementada:** existe infraestructura reutilizable, pero falta parte del contrato solicitado.
- **No implementada:** no existe una operación conectada que cumpla la regla.
- **Dato necesario:** entrada que el flujo debe recibir o persistir; no significa que el dato se haya inventado.

## Resumen de brecha

El módulo ya sincroniza dos obligaciones de proveedor por orden, calcula las fechas de depósito y balance, ejecuta pagos atómicos desde caja o línea, crea disposiciones y grupos de devolución, y amortiza principal/intereses/comisiones con snapshots. La infraestructura existente se reutiliza.

Las brechas funcionales son: idempotency key explícita en el pago individual; refinanciación atómica entre líneas; tesorería operativa asignada con aportaciones/retiradas/ajustes; ciclo `projected/accumulated/confirmed/received` de ingresos Amazon; reserva mínima configurable; evaluación diaria explicable; y recomendación determinista que contemple reserva, próximo ingreso y vencimiento.

No se incluye ninguna integración, entidad, campo ni flujo de Shopify, conforme a la instrucción final del alcance.

## Matriz de reglas

| Regla | Estado | Archivo actual | Servicio | Repositorio | RPC | Tablas | Prueba existente | Dato necesario | Cambio mínimo requerido |
|---|---|---|---|---|---|---|---|---|---|
| Creación depósito | Implementada | `modules/finance/services/syncSupplierPaymentsForOrder.ts` | `syncSupplierPaymentsForOrder` | `financeSupplierPaymentsRepository.ts` | `sync_supplier_payment_plan` | `ordenes_compra`, `finance_supplier_payments` | `supplier_payment_plan_sync_concurrency_validation.sql` | orden confirmada, total, moneda, porcentaje | Añadir fixture y prueba idempotente de exactamente dos obligaciones |
| Creación balance | Implementada | mismos archivos | mismo servicio | mismo repositorio | misma RPC | mismas tablas | misma prueba | orden, logística, fechas | Añadir fixture y aserción de importe/moneda/fecha |
| Fecha AGL | Implementada | `utils/resolveSupplierPaymentDates.ts` | sincronización | repositorio de pagos | `sync_supplier_payment_plan` persiste | pagos, orden, inbound | sin prueba unitaria específica | `amazonInbound.fecha_salida` o `orden.etd` | Añadir prueba determinista |
| Fecha transporte propio | Implementada | `utils/resolveSupplierPaymentDates.ts` | sincronización | repositorio de pagos | persistencia por sync | pagos, orden, contenedor | sin prueba unitaria específica | ETA y `balance_dias_antes_eta` | Añadir prueba determinista |
| Pago desde caja | Parcialmente implementada | `/api/finance/supplier-payments/[id]/mark-paid/route.ts` | `supplierPaymentExecutionService.ts` | `supplierPaymentExecutionRepository.ts` | `mark_and_finance_supplier_payment` | pagos, cuentas, movimientos | `supplier_payment_actual_fx_validation.sql` | cuenta, importes reales, fecha, referencia | Exponer idempotency key y validar fixture integral |
| Pago desde línea | Parcialmente implementada | misma ruta/modal | mismo servicio | mismo repositorio | `mark_and_finance_supplier_payment`, drawdown interno | pagos, líneas, movimientos, grupos | diagnóstico RPC y migración actuals | línea y fecha manual si aplica | Exponer idempotency key, regla bancaria de vencimiento y pruebas 120/90/manual |
| Comisiones separadas | Implementada | `FinancialPlanningPage.tsx`, tipos de ejecución | servicio de ejecución | repositorio de ejecución | `mark_and_finance_supplier_payment` | `bank_fee_eur`, `ff_fee_eur` | `supplierPaymentFinancingActualsMigration.test.mjs` | importes introducidos | Cubrir suma total en pruebas de caja/línea |
| Disposición | Implementada | `creditLineLedgerService.ts` | `createCreditLineDrawdown` | `creditLineLedgerRepository.ts` | `finance_create_credit_line_drawdown` | líneas, movimientos, grupos | diagnósticos ledger/concurrencia | línea, principal, fecha, source, key | Aplicar reglas 120/90/manual por entidad bancaria y probar |
| Vencimiento | Parcialmente implementada | `buildCreditLineMaturities.ts` | ledger/maturities | repositorios ledger/maturities | drawdown crea grupo | grupos, planned maturities | tests SQL de maturities | cycle days o fecha manual | Validación explícita BBVA y fixture |
| Amortización | Implementada | API `credit-lines/[id]/repay` | `createCreditLineRepaymentV2` | ledger repository | `finance_create_credit_line_repayment_v2` | repayments, grupos, líneas, caja, movimientos | `credit_line_repayment_components_test.sql` | principal/interés/comisión/cuenta/key | Integrarla en fixture y conciliación |
| Recuperación de disponible | Implementada | servicio ledger | mismo | mismo | repayment v2 | líneas, repayments | prueba de componentes | principal | Validar antes/después en flujo integral |
| Refinanciación | No implementada | no existe ruta conectada | no existe | no existe | no existe RPC línea-a-línea | infraestructura de líneas/grupos/repayments | no existe | grupo origen, línea financiadora, componentes, fechas, key | Nueva operación atómica, API, servicio y UI mínima |
| Amazon projected | Parcialmente implementada | `buildFinancialPlanning.ts` | motor de planificación | `financialPlanningRepository.ts` | ninguna | `finance_amazon_income_forecasts` | `financialPlanningReadOnly.test.mjs` | fecha, importe, ciclo/marketplace | Ampliar estado/identidad y mantenerlo solo proyectado |
| Amazon confirmed | No implementada | no existe flujo | no existe | lectura genérica actual | no existe | tabla de forecast sin contrato de transición | no existe | ciclo, importe confirmado, key | Operación idempotente de alta/actualización sin caja |
| Amazon received | No implementada | no existe flujo | no existe | no existe | no existe | forecast y cash ledger no enlazados | no existe | cuenta, fecha, importe, key | RPC atómica que marque recibido y cree entrada de caja una vez |
| Reserva mínima | No implementada | lectura genérica de settings | planificación | planning repository | no existe | `finance_settings` | no existe | `minimum_operating_cash_reserve_eur=20000` | Migración idempotente de setting y lectura tipada |
| Caja operativa asignada | No implementada | saldo de `finance_cash_accounts` | planificación | planning repository | no existe operación dedicada | cuentas/movimientos | no existe | aportación, retirada o ajuste | RPC trazable para movimientos operativos y consulta de saldo real |
| Proyección | Parcialmente implementada | `buildFinancialPlanning.ts` | `buildFinancialPlanning` | planning repository | ninguna | pagos, caja, líneas, grupos, Amazon | `financialPlanningReadOnly.test.mjs` | horizonte y fuentes | Evaluación diaria, reserva, estados de ingreso y deuda refinanciada |
| Tensión | Parcialmente implementada | `buildFinancialPlanning.ts` | recomendación mensual actual | planning repository | ninguna | fuentes de planificación | prueba read-only | reserva, mínimo diario, crédito utilizable | Resultado tipado con cinco estados y evidencias |
| Recomendación | Parcialmente implementada | `buildFinancialPlanning.ts` | lógica de fuente sugerida | planning repository | ninguna | caja/líneas/settings/ingresos | prueba read-only | priority, vencimiento, siguiente ingreso, costes | Reglas deterministas explicables sin ejecución automática |

## Brechas de atomicidad, trazabilidad e idempotencia

1. `mark_and_finance_supplier_payment` es atómica, pero su firma efectiva no recibe una idempotency key del cliente; la identidad se deriva internamente y debe verificarse frente a reintentos con payload diferente.
2. `finance_create_credit_line_drawdown` y `finance_create_credit_line_repayment_v2` ya reciben idempotency key y persisten identidades/snapshots.
3. No hay entidad ni RPC para enlazar disposición financiadora y amortización refinanciada.
4. `finance_cash_movements` no tiene idempotency key propia; las operaciones atómicas actuales obtienen unicidad desde su entidad cabecera. La nueva operación de tesorería requiere cabecera o identidad única persistida.
5. `finance_amazon_income_forecasts` no tiene source key/idempotency key ni vínculo a movimiento de caja.

## Brechas de datos y fechas

- El depósito usa `fecha_confirmacion` y, como fallback, `fecha_orden`.
- AGL usa `amazonInbound.fecha_salida` y, como fallback, `orden.etd`.
- Transporte propio usa primero `contenedor.fecha_eta_estimada`, después `eta_real`, después `eta`, y resta `balance_dias_antes_eta` con fallback 10.
- Las líneas actuales disponen de `cycle_days`, pero no existe un campo que identifique explícitamente modalidad manual. La validación efectiva del drawdown exige fecha manual cuando `cycle_days` es nulo.
- El fixture debe crear líneas sintéticas con 120, 90 y `cycle_days NULL` para BBVA.

## Alcance mínimo de implementación derivado

La implementación se limita a:

1. migración incremental para reserva, caja operativa, ciclo Amazon y refinanciación;
2. RPC atómicas para movimientos de tesorería, recepción Amazon y refinanciación;
3. servicios/repositorios/APIs correspondientes;
4. extensión del motor de planificación y recomendación;
5. botón y modal de refinanciación dentro de vencimientos;
6. fixture y limpieza sintéticos exclusivamente locales;
7. pruebas unitarias, SQL, API y verificación UI del flujo solicitado.

No forman parte del cambio SP-API settlements, Shopify, impuestos, conciliación bancaria completa, contabilidad general ni migración remota.

## Evidencia consultada

- `docs/financial/FINANCIAL_LIVE_DOCUMENTATION.md`
- `docs/financial/FINANCIAL_MODULE_AUDIT.md`
- `docs/financial/ERP_BACKUP_FILES_AUDIT.md`
- catálogo `information_schema.columns`, `pg_proc`, `pg_constraint` del contenedor local en transacciones `READ ONLY`
- archivos citados en la matriz y migraciones `finance_*`, `20260721_*`, `20260727_*` a `20260805_*`
