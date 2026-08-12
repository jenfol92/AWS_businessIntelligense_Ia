# Runbook de migración financiera remota

Este procedimiento alinea el esquema financiero remoto e inicializa directamente la deuda legacy definitiva. No carga datos de calendario históricos, no crea fixtures y no ejecuta pagos reales.

## Reglas de seguridad

- Confirmar el `project_ref`, host y nombre de base antes de cada fase.
- Usar una conexión separada y explícitamente `READ ONLY` durante el preflight.
- Detenerse ante cualquier objeto parcial, dato incompatible, error SQL o postcheck fallido.
- No continuar sin backup completo verificable y snapshots de catálogo.
- No borrar tablas, ledgers ni datos financieros para corregir un fallo.
- Conservar los parámetros editables `minimum_operating_cash_reserve_eur=20000` y `amazon_expected_net_ratio=0.75`.

## Manifest exacto

Aplicar, en este orden y una migración cada vez:

1. `20260803_01_unlinked_obligations_schema.sql`
2. `20260803_02_unlinked_obligations_rls.sql`
3. `20260803_03_unlinked_obligation_planning_rpcs.sql`
4. `20260803_04_unlinked_obligation_recurrence_rpcs.sql`
5. `20260803_05_unlinked_obligation_read_models.sql`
6. `20260803_06_unlinked_obligations_role_authorization.sql`
7. `20260804_01_credit_line_authorization_and_read_safety.sql`
8. `20260804_02_credit_line_repayment_components.sql`
9. `20260804_03_credit_line_legacy_regularization.sql`
10. `20260804_04_credit_line_planned_maturities.sql`
11. `20260804_05_credit_line_planned_maturities_hardening.sql`
12. `20260805_01_supplier_payment_financing_actuals.sql`
13. `20260806_01_financial_operating_flow.sql`
14. `20260806_02_supplier_payment_execution_idempotency.sql`
15. `20260806_03_amazon_income_and_operating_account_rpcs.sql`
16. `20260807_01_financial_planning_display_settings.sql`
17. `20260808_01_align_supplier_payment_bank_fee_eur.sql`
18. `20260808_02_close_legacy_opening_and_retire_spreadsheet_schedule.sql`
19. `20260808_04_initialize_legacy_debt.sql`

Quedan expresamente fuera del manifest:

- `20260806_04_fix_amazon_income_partial_unique_upsert.sql` (solo corrige una versión antigua defectuosa de `06_03`, inexistente en este remoto).
- `20260808_03_convert_spreadsheet_schedule_to_legacy_debt.sql`.
- `sql/data/20260804_credit_line_planned_maturities.sql`.
- Cualquier fixture, archivo `FINFLOW_*`, cleanup, seed de desarrollo o UUID sintético.

## 1. Preflight remoto READ ONLY

1. Resolver el proyecto esperado mediante la configuración local autorizada y contrastar `project_ref`, host y base con la consola del proyecto.
2. Abrir una sesión dedicada y ejecutar antes de cualquier consulta:

   ```sql
   begin read only;
   select current_database(), current_user, inet_server_addr(), inet_server_port();
   show transaction_read_only;
   ```

3. Ejecutar `sql/diagnostics/remote_finance_migration_preflight_readonly.sql` y guardar íntegramente la salida.
4. Comparar, objeto por objeto, tablas, columnas/tipos/defaults, constraints, índices, funciones y firmas, triggers, policies RLS, owners y grants con cada migración del manifest.
5. Ejecutar el preflight de `bank_fee_eur` de `20260808_01` sin modificar datos.
6. Confirmar que no existen objetos parciales ni datos financieros productivos incompatibles.
7. Confirmar estas tres líneas y ningún homónimo ambiguo:

   | Banco | ID | Límite | Used previo | Available previo |
   |---|---|---:|---:|---:|
   | Caja Rural | `8bb7c55d-0582-4c6f-a097-9ea4eea05bbe` | 600.000 | 521.500 | 78.500 |
   | La Caixa | `a6dcc3a3-f065-47f5-a64b-9631af55e0bc` | 200.000 | 135.000 | 65.000 |
   | BBVA | `b24d9e3c-698c-4c14-bd1c-5c511b19e4d1` | 250.000 | 85.000 | 165.000 |

8. Confirmar que no hay regularizaciones legacy, items legacy, grupos legacy ni movimientos `legacy_opening_balance` sobre esas líneas, y que no existen grupos abiertos o parcialmente pagados que expliquen sus saldos.
9. Confirmar que `finance_credit_line_planned_maturities` no contiene filas operativas; la tabla puede existir vacía como parte del esquema.
10. Cerrar con `rollback;`. Si `transaction_read_only` no era `on`, descartar el preflight y repetirlo correctamente.

## 2. Backup remoto verificable

1. Bloquear el inicio de migraciones durante la captura.
2. Crear un dump completo en formato custom con la versión de `pg_dump` compatible con el servidor, incluyendo esquema, datos, blobs, owners y ACL cuando corresponda.
3. Registrar ruta, UTC, `project_ref`, versión de PostgreSQL, tamaño en bytes y SHA-256.
4. Verificar el dump mediante `pg_restore --list`; guardar el listado y comprobar que contiene los objetos financieros esperados.
5. Probar la restauración en una base PostgreSQL desechable compatible y ejecutar los conteos/saldos de control. Un hash calculado sin restauración de prueba no basta.
6. Guardar snapshots separados y con SHA-256 de:

   - definiciones completas de RPC (`pg_get_functiondef`), owner y ACL;
   - RLS habilitado/forzado y todas las policies;
   - grants de tablas, secuencias y rutinas;
   - triggers y sus funciones;
   - constraints e índices;
   - conteos de tablas financieras;
   - saldos de líneas, grupos, movimientos, cuentas de caja y settings.

No continuar si el dump no se puede listar y restaurar, si faltan hashes/tamaños o si los snapshots no son reproducibles.

## 3. Aplicación del esquema

1. Congelar el manifest anterior con hashes SHA-256 de cada archivo revisado.
2. Antes de cada migración, volver a comprobar que el objeto que introduce sigue ausente y que no apareció estado parcial desde el preflight.
3. Aplicar exactamente una migración. Los archivos que contienen `BEGIN/COMMIT` se ejecutan tal como están; cualquier archivo transaction-neutral se ejecuta con `psql --single-transaction --set=ON_ERROR_STOP=1 -f <archivo>`.
4. Exigir código de salida cero y registrar hora, hash del archivo y salida completa.
5. Tras cada `COMMIT`, ejecutar un postcheck READ ONLY limitado a los objetos creados/modificados: definición, constraints validadas, índices, RPC, triggers, RLS y grants.
6. Comparar saldos y conteos financieros con el snapshot anterior. Una migración de esquema no puede introducir fixtures ni alterar saldos salvo cuando su propio contrato lo indique expresamente.
7. Si falla la migración o el postcheck, aplicar la regla de parada; no avanzar al siguiente archivo.

Después de `20260808_02`, comprobar específicamente que:

- el RPC legacy v2 acepta `disposition_date` nulo y mantiene componentes de intereses/comisiones;
- el calendario histórico está retirado del modelo operativo;
- no se ha cargado ninguna fila de datos de apertura;
- siguen configurados `minimum_operating_cash_reserve_eur=20000` y `amazon_expected_net_ratio=0.75`.

## 4. Ensayo transaccional de `08_04`

1. Repetir inmediatamente el preflight de líneas y ausencia total de inicialización legacy.
2. Ejecutar la migración sin confirmar:

   ```text
   psql --set=ON_ERROR_STOP=1
   BEGIN;
   \i sql/migrations/20260808_04_initialize_legacy_debt.sql
   -- ejecutar dentro de esta misma sesión todos los postchecks de esta sección
   ROLLBACK;
   ```

3. Antes del `ROLLBACK`, exigir:

   - 3 regularizaciones legacy, una por línea;
   - 33 items, 33 grupos `legacy_regularization` y 33 movimientos `adjustment`/`legacy_opening_balance`;
   - Caja Rural: 17 grupos y 588.329 EUR;
   - La Caixa: 7 grupos y 196.000 EUR;
   - BBVA: 9 grupos y 208.900 EUR;
   - total: 33 grupos y 993.229 EUR;
   - 33 `source_key` canónicos únicos en `item.reference`;
   - cada item enlazado exactamente a un grupo y un movimiento;
   - cero duplicados, importes negativos o saldos negativos;
   - cero drawdowns, cero cambios de caja y cero datos sintéticos;
   - `available_amount = credit_limit - used_amount` en las tres líneas.

4. Después del `ROLLBACK`, comparar conteos y saldos con el preflight. Deben ser idénticos y no debe quedar ninguna fila legacy.

## 5. Ejecución definitiva de `08_04`

1. Si y solo si el ensayo y su rollback pasan, repetir el preflight de concurrencia/estado.
2. Ejecutar `20260808_04_initialize_legacy_debt.sql` con `psql --single-transaction --set=ON_ERROR_STOP=1`.
3. Ejecutar inmediatamente el mismo postcheck exacto del ensayo.
4. Ejecutar una segunda vez dentro de `BEGIN/ROLLBACK`: debe validar el estado exacto sin insertar ni actualizar filas, demostrando el no-op idempotente.
5. Verificar saldos finales:

   | Banco | Grupos | Used | Available |
   |---|---:|---:|---:|
   | Caja Rural | 17 | 588.329 | 11.671 |
   | La Caixa | 7 | 196.000 | 4.000 |
   | BBVA | 9 | 208.900 | 41.100 |

## 6. Postchecks y smoke autenticado

1. Repetir snapshots de catálogo, RLS, grants, triggers, conteos y saldos; comparar con el resultado esperado del manifest.
2. Confirmar RLS con un usuario autenticado de rol permitido y confirmar denegación con un rol no autorizado.
3. Abrir `/finanzas/planificacion` con una sesión autenticada y verificar, sin ejecutar pagos:

   - respuesta correcta de página y APIs;
   - 33 cards cronológicas `CRÉDITO · DEUDA INICIAL`;
   - botón único `Pagar y liberar` en cada card;
   - conteos 17/7/9 e importes exactos;
   - vencidos anteriores al horizonte visibles;
   - `Pendiente > Líneas`, tensión de tesorería y liberaciones incluyen los vencimientos;
   - ninguna card operativa procede del calendario histórico;
   - ningún dato sintético creado.

4. No confirmar modales de pago, no invocar RPC de pago/refinanciación y no alterar caja durante el smoke.

## Regla de parada y recuperación

Ante cualquier diferencia o error:

1. Detener la secuencia y no aplicar migraciones posteriores.
2. Si la transacción actual sigue abierta, ejecutar `ROLLBACK` y comprobar que conteos/saldos vuelven al snapshot anterior.
3. Si el fallo ocurrió después de un `COMMIT`, preservar evidencias, identificar el último commit correcto y evaluar el impacto contra los snapshots. No improvisar SQL inverso ni borrar tablas/ledgers.
4. Restaurar el backup verificado únicamente con autorización explícita, en ventana controlada, y preferentemente ensayar primero la restauración en una base separada.
5. Informar exactamente: migración fallida, error, objetos comprometidos, saldos antes/después y si es necesaria restauración.

El estado final solo es `GO` cuando todas las migraciones, invariantes, comparación de snapshots y smoke autenticado pasan. Cualquier punto pendiente mantiene `NO-GO`.
