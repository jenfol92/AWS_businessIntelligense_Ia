# Preflight de migración financiera a Supabase remoto

Fecha de auditoría: 2026-08-07
Ámbito local: `supabase_db_ERP_BACKUP`
Proyecto remoto identificado: `joqktmejdxkqrzncvxin`
Operaciones remotas ejecutadas: ninguna
Veredicto: **NO-GO**

## 1. Resumen ejecutivo

El esquema financiero local contiene la cadena funcional comprendida entre
`20260804_01` y `20260807_01`, pero el despliegue remoto no es reproducible todavía.

Bloqueos:

1. No fue posible consultar el catálogo remoto. El entorno solo contiene JWT del
   stack local (`iss=supabase-demo`), no hay Supabase CLI autenticada y no existe
   navegador conectado. Por tanto, ningún objeto remoto se declara presente o
   ausente sin evidencia.
2. Ocho migraciones (`20260804_04` a `20260807_01`, contando `20260806_04`)
   no están bajo seguimiento Git.
3. La base local no contiene `supabase_migrations.schema_migrations`; sus objetos
   se aplicaron con `psql` y se verificaron estructuralmente.
4. `finance_supplier_payments.bank_fee_eur` es `numeric` sin precisión en local,
   mientras el contrato SQL objetivo es `numeric(14,2)`.
5. Los 33 registros `spreadsheet_schedule` no son deuda conciliada y quedan fuera
   de cualquier despliegue.

No se ejecutó DDL, DML, reset, migración, seed ni escritura remota.

## 2. Migraciones recientes y estado Git

### Ya versionadas

| Archivo | SHA-256 |
|---|---|
| `20260804_01_credit_line_authorization_and_read_safety.sql` | `63ba2dfc71fb65d41c8de7085ff7f93617a8793aac86082a08b9cea9ba4e8aaf` |
| `20260804_02_credit_line_repayment_components.sql` | `03b5ef0781fd6063563b7d4b0c7a1040f99cbdcd4fffd5381b41565fc97fd0d6` |
| `20260804_03_credit_line_legacy_regularization.sql` | `48e719ec369d3d884bfcfd938b201eaf6d81d97db4fac6e37d29bbc1099ef65e` |

### Deben versionarse antes de cualquier despliegue

| Orden lógico | Archivo | SHA-256 | Decisión |
|---:|---|---|---|
| 1 | `20260804_04_credit_line_planned_maturities.sql` | `db837d42fe64081659bf8cde66501409020f7cf127e7913ad78cc0aa32033065` | Versionar; esquema sin seed externo. |
| 2 | `20260804_05_credit_line_planned_maturities_hardening.sql` | `886421749385cee30107488615c526955fb99ea79d704c3174e06e900da75b81` | Versionar; hardening e idempotencia. |
| 3 | `20260805_01_supplier_payment_financing_actuals.sql` | `a9f2385482770f559a966eb60f5b64b748c8b3a8782e500ddd4fe524e1a0c771` | Versionar. |
| 4 | `20260806_01_financial_operating_flow.sql` | `da3abb0e6e124d03e191b0a99aa744299f112db5b99a83b078679c9bf725ea74` | Versionar. |
| 5 | `20260806_02_supplier_payment_execution_idempotency.sql` | `72b47b3c7127b91574a7139e6bcf9ea063ffd872eb0c3543576fa339676c471b` | Versionar. |
| 6 | `20260806_03_amazon_income_and_operating_account_rpcs.sql` | `2a87a9fc13d0f464914136db41d659ab8ff8a2975813d09a4b6d1cf5f4669341` | Versionar; ya contiene el upsert corregido. |
| — | `20260806_04_fix_amazon_income_partial_unique_upsert.sql` | `3a1fa5a33038f28aa162c6210adc38abaad349411238de68e7bd60fa8f00fea1` | Versionar como corrección histórica, pero no aplicar en instalación limpia después del `06_03` actual. |
| 7 | `20260807_01_financial_planning_display_settings.sql` | `d1a0701cf26f72f7f1b7b08bd5d1aec882d3a66fcbfa4f8e229ca27f21940759` | Versionar; configuración propuesta. |

No se hizo `git add`, commit ni modificación de estos SQL durante este preflight.

## 3. Esquema local verificado

La verificación se hizo directamente contra `pg_catalog`, `information_schema` y
las tablas financieras del PostgreSQL local.

### Tablas y columnas

Están presentes y con RLS activa:

- `finance_credit_line_repayments`;
- `finance_credit_line_legacy_regularizations`;
- `finance_credit_line_legacy_regularization_items`;
- `finance_credit_line_planned_maturities`;
- `finance_operating_treasury_operations`;
- `finance_credit_line_refinancings`;
- `finance_supplier_payment_executions`.

También están presentes:

- `finance_cash_accounts.is_operating_treasury boolean NOT NULL DEFAULT false`;
- las columnas Amazon `source_key`, `marketplace`, `cycle_start`, `cycle_end`,
  `estimated_gross_eur numeric(14,2)`, `historical_net_ratio numeric(9,6)`,
  `confirmed_amount_eur numeric(14,2)`, `received_amount_eur numeric(14,2)`,
  `received_at`, `cash_account_id`, `cash_movement_id` e `idempotency_key`;
- `actual_amount_original numeric(14,4)`;
- `actual_amount_eur numeric(14,2)`;
- `ff_fee_eur numeric(14,2)`;
- `bank_fee_eur numeric` sin precisión: deriva pendiente.

### Constraints relevantes

- Componentes de amortización no negativos y total igual a principal + intereses
  + comisiones.
- Snapshots de crédito/caja no negativos.
- Repayments inmutables y estados `posted|reversed`.
- Regularización legacy: total declarado igual al gap derivado, idempotencia única
  y estado inmutable `posted`.
- Items legacy: principal positivo, fecha de disposición no posterior al
  vencimiento y enlaces obligatorios a grupo/movimiento.
- Planned maturities: importe finito positivo, estados `planned|paid|cancelled`,
  source key único y vínculo de repayment coherente.
- Refinanciación: líneas origen/destino distintas, total financiado igual a
  principal + intereses + fees y principal refinanciado igual al principal.
- Operaciones de tesorería: importe positivo, dirección `in|out` y tipo permitido.
- Ejecuciones de proveedor: supplier payment e idempotency key obligatorios.

### Índices

Verificados:

- repayment: índices por grupo/fecha y línea/fecha; únicos de idempotencia,
  cash movement y credit-line movement;
- legacy: índices por línea, operación y repayment group; idempotencia única;
- planned maturities: `ux_..._source_key`, `ix_..._line_due` e
  `ix_..._status_due`;
- repayment groups: unicidad operacional por periodo y legacy por origen/fecha;
- Amazon: únicos parciales de `source_key` e `idempotency_key`;
- operaciones, refinanciaciones y ejecuciones: PK e idempotency keys únicas.

### RPC

Están activas localmente:

- `finance_create_credit_line_repayment_v2`;
- `finance_register_legacy_opening_balance_v2`;
- `finance_create_credit_line_planned_maturity`;
- `finance_update_credit_line_planned_maturity`;
- `finance_cancel_credit_line_planned_maturity`;
- `finance_finance_supplier_payment_phase1a_impl` (`SECURITY INVOKER`);
- `finance_record_operating_treasury_operation`;
- `finance_receive_amazon_income`;
- `finance_refinance_credit_line`;
- `finance_execute_supplier_payment`;
- `finance_upsert_amazon_income` con advisory lock + `SELECT FOR UPDATE`;
- `finance_set_operating_cash_account`.

Las RPC públicas operativas verificadas son `SECURITY DEFINER`, con ejecución para
`authenticated` y `service_role`; la implementación interna de financiación es
`SECURITY INVOKER` y no expone ejecución directa a esos roles.

### Triggers

- `finance_credit_line_repayments_immutable`;
- `finance_credit_line_movements_no_legacy_drawdown`;
- `finance_credit_line_legacy_regularizations_immutable`;
- `finance_credit_line_legacy_items_immutable`.

### RLS y grants

Políticas SELECT verificadas:

- líneas, grupos, caja, repayments y legacy mediante
  `finance_can_read_treasury()`;
- refinanciaciones y ejecuciones mediante
  `finance_can_read_unlinked_details()`;
- planned maturities mediante `finance_can_read_treasury()`.

`authenticated` tiene SELECT, no DML directo, sobre las tablas nuevas.
`service_role` y `postgres` conservan privilegios administrativos.

### Estado de datos local

- `spreadsheet_schedule`: 33 filas `planned`, 993.229 EUR. Excluidas.
- Filas `FINFLOW_*`: 0.
- Refinanciaciones persistidas: 0.
- Ejecuciones de proveedor persistidas: 0.
- Operaciones de tesorería persistidas: 0.
- Cuentas marcadas como tesorería operativa: 0.
- Configuración propuesta presente localmente:
  - `minimum_operating_cash_reserve_eur=20000`;
  - `amazon_expected_net_ratio=0.75`.

Estos dos valores son configuración empresarial editable, no datos financieros
que deban asumirse como definitivos en producción.

## 4. Esquema remoto

Estado: **NO DETERMINABLE POR FALTA DE ACCESO READ ONLY**.

Evidencia de bloqueo:

- proyecto identificado: `joqktmejdxkqrzncvxin`;
- `NEXT_PUBLIC_SUPABASE_URL` disponible apunta a `127.0.0.1:54321`;
- JWT válido disponible: emisor `supabase-demo`, roles locales `anon` y
  `service_role`;
- no existe `SUPABASE_ACCESS_TOKEN`, conexión PostgreSQL remota ni Supabase CLI
  autenticada;
- no hay navegador conectado con sesión de Supabase.

No se intentó sustituir la falta de credenciales con escrituras, funciones RPC
de diagnóstico ni inferencias basadas en nombres de migración.

### Estado remoto por migración

| Migración | Estado remoto basado en objetos |
|---|---|
| `20260804_01` | No determinable |
| `20260804_02` | No determinable |
| `20260804_03` | No determinable |
| `20260804_04` | No determinable |
| `20260804_05` | No determinable |
| `20260805_01` | No determinable |
| `20260806_01` | No determinable |
| `20260806_02` | No determinable |
| `20260806_03` | No determinable |
| `20260806_04` | No distinguible estructuralmente de un `06_03` ya corregido |
| `20260807_01` | No determinable |

Para levantar el bloqueo se necesita una conexión PostgreSQL remota con rol de
catálogo y transacción `READ ONLY`, o una sesión de Dashboard que permita leer
tablas, funciones, políticas y grants. La comparación debe repetir exactamente
las consultas locales a `pg_class`, `pg_attribute`, `pg_constraint`, `pg_indexes`,
`pg_proc`, `information_schema.triggers`, `pg_policies`,
`information_schema.role_table_grants` e
`information_schema.role_routine_grants`.

## 5. Diferencias confirmadas

Solo pueden afirmarse diferencias dentro del entorno local/repositorio:

1. Ocho migraciones recientes no están versionadas.
2. `bank_fee_eur` difiere del tipo objetivo.
3. El historial formal de migraciones está ausente localmente.
4. El SQL `06_04` es redundante en una instalación limpia que ejecute el
   `06_03` corregido.
5. Los datos externos `spreadsheet_schedule` existen localmente pero quedan fuera
   del paquete remoto.

No se afirma ninguna diferencia local/remoto hasta disponer de catálogo remoto.

## 6. Propuesta incremental para `bank_fee_eur`

Migración incremental creada y validada únicamente en local:

`sql/migrations/20260808_01_align_supplier_payment_bank_fee_eur.sql`

Contenido mínimo propuesto:

```sql
begin;

do $$
begin
  if exists (
    select 1
    from public.finance_supplier_payments
    where bank_fee_eur is not null
      and (
        not public.finance_is_finite_numeric(bank_fee_eur)
        or bank_fee_eur <> round(bank_fee_eur, 2)
        or abs(bank_fee_eur) >= 1000000000000
      )
  ) then
    raise exception 'BANK_FEE_EUR_NOT_COMPATIBLE_WITH_NUMERIC_14_2';
  end if;
end $$;

alter table public.finance_supplier_payments
  alter column bank_fee_eur type numeric(14,2)
  using bank_fee_eur::numeric(14,2);

commit;
```

La guarda evita redondeo o overflow silencioso. El preflight local observó cero
valores no nulos en `bank_fee_eur`, por lo que localmente el cambio sería
compatible. Debe repetirse la misma guarda en remoto antes de autorizar la
migración. El archivo ya existe y se aplicó satisfactoriamente solo en
`supabase_db_ERP_BACKUP`; el preflight remoto sigue pendiente.

## 7. Exclusiones obligatorias

No deben aplicarse ni cargarse en producción:

- `sql/data/20260804_credit_line_planned_maturities.sql`;
- cualquier fila o importador `spreadsheet_schedule`;
- `sql/data/financial_operating_flow_fixture.sql`;
- cualquier registro `FINFLOW_*` o UUID sintético `f1000000-*`;
- `sql/data/financial_operating_flow_fixture_cleanup.sql`;
- datos de deuda legacy no conciliados;
- `20260806_04` cuando se instale directamente el `20260806_03` corregido.

## 8. Orden exacto propuesto

El orden queda condicionado por la comparación remota. Para un remoto que no
tenga ninguno de los objetos:

1. `20260804_01_credit_line_authorization_and_read_safety.sql`
2. `20260804_02_credit_line_repayment_components.sql`
3. `20260804_03_credit_line_legacy_regularization.sql`
4. `20260804_04_credit_line_planned_maturities.sql`
5. `20260804_05_credit_line_planned_maturities_hardening.sql`
6. `20260805_01_supplier_payment_financing_actuals.sql`
7. `20260806_01_financial_operating_flow.sql`
8. `20260806_02_supplier_payment_execution_idempotency.sql`
9. `20260806_03_amazon_income_and_operating_account_rpcs.sql`
10. `20260807_01_financial_planning_display_settings.sql`, solo después de aprobar
    la reserva y ratio propuestos.
11. `20260808_01_align_supplier_payment_bank_fee_eur.sql`.
12. `20260808_02_close_legacy_opening_and_retire_spreadsheet_schedule.sql`.

No incluir `20260806_04` en esta secuencia limpia. Si el catálogo remoto demuestra
que ya recibió una versión antigua defectuosa de `06_03`, entonces `06_04` pasa a
ser corrección imprescindible y debe ejecutarse inmediatamente después de esa
versión.

## 9. Riesgos

### Bloqueantes

- catálogo remoto no inspeccionado;
- ocho migraciones no versionadas;
- ausencia de manifest/ledger reconciliado;
- deriva `bank_fee_eur` sin preflight remoto;
- baseline remoto desconocido: `04_04` usa `CREATE TABLE` sin `IF NOT EXISTS` y
  fallaría ante una aplicación parcial.

### Altos

- grants o RLS remotos distintos pueden abrir o bloquear datos financieros;
- el wrapper público y la implementación interna de financiación deben conservar
  exactamente su frontera `SECURITY DEFINER` / `SECURITY INVOKER`;
- la concurrencia real de refinanciación en dos sesiones no está validada;
- ninguna cuenta productiva ha sido designada como tesorería operativa.

### Datos

- prohibido convertir automáticamente los 33 vencimientos externos en deuda;
- la apertura legacy futura debe coincidir con el gap real por línea y queda fuera
  de este preflight;
- reserva y ratio Amazon son configurables y requieren aprobación empresarial.

## 10. Rollback propuesto

No debe existir un rollback destructivo genérico. Antes del despliegue autorizado:

1. backup remoto verificable;
2. snapshot de definiciones, grants, políticas y conteos financieros;
3. cada migración dentro de su propia transacción;
4. preflight que aborte ante objetos parciales o datos incompatibles;
5. smoke autenticado antes de continuar con la siguiente fase.

Si falla antes de `COMMIT`, ejecutar `ROLLBACK`. Si falla después de un commit:

- detener la secuencia;
- no borrar tablas ni movimientos;
- restaurar definiciones RPC/RLS desde el snapshot;
- revertir `bank_fee_eur` a `numeric` solo si fuera estrictamente necesario y no
  hubiera escrituras posteriores;
- restaurar desde backup si se hubiera producido cualquier mutación financiera
  inesperada.

Las tablas de ledger, repayments, refinanciaciones y operaciones no deben vaciarse
ni eliminarse como mecanismo de rollback.

## 11. Veredicto

**NO-GO**.

Condiciones mínimas para cambiar a GO:

1. proporcionar acceso de catálogo remoto READ ONLY;
2. completar comparación objeto por objeto y clasificar cada migración como
   efectiva, parcial o ausente;
3. versionar los ocho SQL pendientes y la migración incremental de tipo;
4. aprobar los valores configurables o retirarlos de la secuencia;
5. ejecutar preflight remoto de `bank_fee_eur`;
6. confirmar exclusión de seeds, fixtures, `spreadsheet_schedule` y deuda legacy;
7. preparar backup y plan de rollback verificables.
