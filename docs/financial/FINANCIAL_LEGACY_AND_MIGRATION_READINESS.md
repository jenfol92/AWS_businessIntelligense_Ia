# Cierre legacy y preparación de migración financiera

Fecha: 2026-08-07
Base validada: `supabase_db_ERP_BACKUP`
Remoto: no modificado
Veredicto: **NO-GO**

## Resultado

El modelo local ya concilia deuda inicial legacy por línea mediante varios tramos
reales. Cada tramo genera exactamente un repayment group
`group_origin_type='legacy_regularization'`, aunque compartan vencimiento.
Registrar la regularización explica el `used_amount` existente y no lo aumenta.

La UI muestra límite, usado, principal explicado, gap, suma y diferencia, y no
permite confirmar si los tramos no coinciden exactamente con el gap. Cada tramo
admite principal, vencimiento, disposición opcional, referencia opcional e
intereses/comisiones conocidos opcionales.

Los grupos legacy abiertos o parciales aparecen como `CRÉDITO · VENCIMIENTO` y
usan el único modal `Pagar y liberar`, con `Caja propia` o `Línea de crédito`. El
pago desde caja reduce caja por principal más intereses y comisiones, liberando
solo principal. El parcial conserva `partially_paid`. La refinanciación amortiza
el grupo legacy y crea un grupo nuevo `operational_cycle`, con principal,
intereses y comisiones trazados por separado.

`spreadsheet_schedule` queda retirado del BI operativo: el repositorio lo excluye
antes de construir calendario, tensión, liberaciones y recomendaciones. Un
trigger impide nuevas inserciones o conversiones a esa fuente, conservando las
filas históricas locales existentes.

## Migraciones nuevas y objetos

- `20260808_01_align_supplier_payment_bank_fee_eur.sql`: preflight contra no
  finitos, más de dos decimales y overflow antes de `numeric(14,2)`.
- `20260808_02_close_legacy_opening_and_retire_spreadsheet_schedule.sql`: costes
  conocidos en items legacy, disposición nullable, un grupo por tramo, RPC v2
  actualizada y bloqueo de `spreadsheet_schedule`.

Objetos afectados: `finance_supplier_payments`,
`finance_credit_line_legacy_regularization_items`,
`finance_register_legacy_opening_balance_v2(uuid,jsonb,text)`, índice no único
`ix_finance_credit_line_repayment_groups_legacy_due`, función
`finance_reject_spreadsheet_schedule_write()` y trigger
`finance_planned_maturities_no_spreadsheet_schedule`. No se añadieron tablas
operativas nuevas.

Ambas migraciones se aplicaron solo en local tras crear
`/tmp/financial_pre_20260808.dump` (10.547.743 bytes). No se generó deuda legacy
real ni se modificó remoto.

## Paquete limpio y orden exacto

Si el catálogo remoto demuestra ausencia de todos los objetos:

1. `20260804_01_credit_line_authorization_and_read_safety.sql`
2. `20260804_02_credit_line_repayment_components.sql`
3. `20260804_03_credit_line_legacy_regularization.sql`
4. `20260804_04_credit_line_planned_maturities.sql`
5. `20260804_05_credit_line_planned_maturities_hardening.sql`
6. `20260805_01_supplier_payment_financing_actuals.sql`
7. `20260806_01_financial_operating_flow.sql`
8. `20260806_02_supplier_payment_execution_idempotency.sql`
9. `20260806_03_amazon_income_and_operating_account_rpcs.sql` corregida
10. `20260807_01_financial_planning_display_settings.sql`
11. `20260808_01_align_supplier_payment_bank_fee_eur.sql`
12. `20260808_02_close_legacy_opening_and_retire_spreadsheet_schedule.sql`

`20260806_04` no se instala si el paso 9 usa la versión corregida. Solo sería
necesario si el catálogo probase una versión antigua de `06_03` ya efectiva.

Migraciones financieras recientes sin seguimiento Git que deben versionarse:
`20260804_04`, `20260804_05`, `20260805_01`, `20260806_01`, `20260806_02`,
`20260806_03`, `20260806_04` (parche condicional, fuera de clean install),
`20260807_01`, `20260808_01` y `20260808_02`.

## Exclusiones de producción

No migrar ni ejecutar:

- `sql/data/20260804_credit_line_planned_maturities.sql`;
- cualquier dato o carga `spreadsheet_schedule`;
- `financial_operating_flow_fixture.sql` y su cleanup;
- fixtures, claves `FINFLOW_*` o UUID `f1000000-*`;
- deuda legacy no conciliada;
- `20260806_04` en instalación limpia con `06_03` corregida.

`minimum_operating_cash_reserve_eur=20000` y
`amazon_expected_net_ratio=0.75` son configuración editable propuesta.

## Pruebas locales

- `financial_legacy_end_to_end_test.sql`: PASS con rollback; gap incorrecto,
  varios tramos, fecha desconocida, costes conocidos, idempotencia, pago parcial,
  pago completo, caja, liberación exclusiva de principal, refinanciación y nuevo
  grupo operativo.
- `credit_line_legacy_regularization_test.sql`: PASS con rollback; permisos,
  límites, trazabilidad, inmutabilidad, saldo e idempotencia.
- `financial_operating_flow_fixture.sql`: `FINFLOW_FIXTURE_PASS`, con rollback.
- Tests financieros Node: 72/72 PASS, incluida exclusión de
  `spreadsheet_schedule` antes del motor de tensión.
- `npx tsc --noEmit`: PASS.
- `npm run build`: PASS; Next.js compiló y generó 41 páginas.

## Local frente a remoto

No existe en este entorno una conexión PostgreSQL remota READ ONLY ni una sesión
de catálogo autorizada. No se afirma que ninguna migración de `20260804_01` a
`20260808_02` esté presente, parcial o ausente en remoto: todas quedan **no
determinables**. La checklist de `FINANCIAL_REMOTE_MIGRATION_PREFLIGHT.md` debe
comparar tablas, columnas, tipos, constraints, índices, definiciones RPC,
triggers, RLS, owners y grants mediante catálogo y transacción `READ ONLY`; los
nombres del historial no son evidencia.

## Riesgos, rollback y veredicto

Bloquean GO: catálogo remoto desconocido, SQL aún no versionado, preflight remoto
de `bank_fee_eur` pendiente y deuda productiva aún no conciliada. También quedan
pendientes una prueba UI autenticada y concurrencia real en dos sesiones.

Antes de desplegar: backup remoto verificable, snapshot de catálogo/ACL,
aplicación transaccional migración a migración y smoke autenticado entre pasos.
Ante fallo pre-commit, rollback; tras commit, detener la secuencia y restaurar
definiciones desde snapshot, sin truncar ni borrar ledgers.

**NO-GO para migrar al remoto.** Siguiente paso exacto: añadir bajo seguimiento
Git los SQL enumerados (sin commit automático), abrir una sesión remota
estrictamente READ ONLY, ejecutar la checklist de catálogo y construir con el
resultado el manifest final. Solo entonces se reconsidera GO.
