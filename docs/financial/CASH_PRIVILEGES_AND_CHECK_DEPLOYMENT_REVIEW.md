# Revisión de privilegios de caja y despliegue del CHECK — 2026-09-10

## Verificado en producción

Se reutilizó el preflight cerrado de `.codex-work/finance-preflight-result.json`; no se repitió la auditoría de RLS unlinked ni la comparación de las 49 funciones financieras. Las lecturas adicionales estuvieron dirigidas a capacidades efectivas, roles, ACL de columnas, superficie SQL fuera de `finance_*` y triggers de las dos tablas. Terminaron con `ROLLBACK`. Evidencia adicional: `.codex-work/cash-privileges-result.json` y `.codex-work/cash-api-surface-result.json`. No hubo migraciones, pagos ni escrituras de datos.

### Capacidades efectivas, antes del repair

`has_table_privilege`, incluyendo herencia y PUBLIC, confirmó esta matriz. Ambas tablas pertenecen a `postgres`; no hay ACL particulares en sus columnas ni grants a PUBLIC en sus ACL de tabla.

| Privilegio | anon: cuentas | authenticated: cuentas | anon: movimientos | authenticated: movimientos |
|---|---|---|---|---|
| SELECT | Sí | Sí | Sí | Sí |
| INSERT | Sí | Sí | No | No |
| DELETE | Sí | Sí | No | No |
| UPDATE | No | No | No | No |
| TRUNCATE | Sí | Sí | Sí | Sí |
| TRIGGER | Sí | Sí | Sí | Sí |
| REFERENCES | Sí | Sí | Sí | Sí |
| MAINTAIN | Sí | Sí | Sí | Sí |

`MAINTAIN` apareció en la ACL (`m`) y se confirmó en una consulta específica. No basta con la lista inicial de `information_schema.role_table_grants` para describir todas las capacidades presentes.

Los grants no equivalen a filas accesibles: el preflight previo muestra RLS activo, una política SELECT de cuentas para authenticated condicionada por `finance_can_read_treasury()`, y ninguna política en movimientos. Por tanto, las escrituras directas de cuentas ya están denegadas por falta de política; el SELECT de movimientos no devuelve filas a roles sometidos a RLS. No se añade una política nueva en este trabajo.

### Roles y superficie API

- La conexión de inspección mediante DATABASE_URL usa `session_user=current_user=postgres`; tiene BYPASSRLS y no es el contexto de autorización del navegador.
- `anon` y `authenticated`: NOLOGIN, sin superusuario ni BYPASSRLS, sin CREATE en public. No reciben membresías adicionales en el catálogo inspeccionado.
- `authenticator`: LOGIN, NOINHERIT, sin BYPASSRLS ni privilegios efectivos propios en las dos tablas; es miembro de anon/authenticated/service_role. Es compatible con el cambio de rol por petición de PostgREST. La configuración del proceso administrado y el rol exacto de una sesión HTTP concreta no se observaron directamente; no se deben confundir con la conexión postgres del diagnóstico.
- `service_role`: NOLOGIN, BYPASSRLS y todos los privilegios sobre ambas tablas. Las claves de backend se usan por API, no como contraseña SQL de ese rol.
- Dos HEAD públicos (`select=id&limit=0`) devolvieron 200; no se solicitaron filas. La clave configurada es publishable, sin JWT de usuario. El GET de OpenAPI devolvió 401, por lo que no se obtuvo un inventario completo de rutas desde ese endpoint. No se probaron POST/PATCH/DELETE ni llamadas RPC.
- PostgREST traduce operaciones REST a SQL y cambia de rol según autenticación; no es un ejecutor genérico de SQL. DELETE no significa TRUNCATE. Un grant TRUNCATE por sí solo no demuestra una vía HTTP para invocarlo. [Autenticación de PostgREST](https://docs.postgrest.org/en/stable/references/auth.html).
- El catálogo público fuera de finance_* encontró cuatro funciones candidatas por referencias a caja o SQL dinámico: implementación privada de pago vinculado SECURITY DEFINER sin EXECUTE de anon/authenticated; lector `get_purchase_payment_batch_detail(uuid)` SECURITY INVOKER autorizado a authenticated; y dos funciones trigger de precios cuyo SQL dinámico apunta a producto_precios. No se encontró en esas candidatas un ejecutor genérico de TRUNCATE o SQL arbitrario accesible como RPC. Esto no inventaría una garantía sobre otros esquemas, extensiones, wrappers indirectos o procesos externos.
- Los 28 triggers encontrados en las dos tablas son internos de claves foráneas. No se ejecutaron; esta inspección sirve para evaluar permisos, no para certificar concurrencia global.

## Verificado solo en código/local

| Consumidor | Acceso observado | Dependencia de los grants propuestos para revocar |
|---|---|---|
| financialPlanningRepository, recurringPaymentsRepository, purchase-payment-candidates | SELECT directo de cuentas mediante cliente con sesión | Ninguna: authenticated SELECT se conserva |
| creditLineLedgerRepository.fetchCashAccountById | SELECT directo de cuenta | Se conserva |
| creditLineLedgerRepository.fetchCashMovementById | SELECT directo de movimiento en helper legacy | Se conserva; RLS actual ya impide ver filas. No se encontraron llamadas al helper legacy fuera de su definición; no se altera ese comportamiento |
| get_purchase_payment_batch_detail | SECURITY INVOKER; JOIN a cuentas | Necesita SELECT de authenticated, que se conserva |
| Reembolsos V2, pago de proveedor, pago vinculado, tesorería operativa, recepción Amazon | Escritura mediante RPC; entrada SECURITY DEFINER o backend | No necesitan INSERT/DELETE/TRUNCATE del rol del navegador |
| finance_finance_supplier_payment_phase1a_impl | Implementación SECURITY INVOKER llamada por wrapper SECURITY DEFINER | Hereda el contexto del wrapper; no necesita grants de tabla al usuario final |
| Nuevo pago recurrente | SECURITY DEFINER; escribe movimiento y cuenta | Independiente del repair histórico |
| Fixtures y migraciones | DDL, INSERT y FK bajo propietario/administración | REFERENCES/TRIGGER se necesitan para crear objetos, no para mantener FK/triggers ya existentes; no se revocan al propietario |

Se buscaron referencias en app, modules, server, scripts y sql. No se encontraron escrituras directas de aplicación en estas tablas ni un proceso existente que dependa de TRUNCATE, MAINTAIN, TRIGGER o REFERENCES concedidos a anon/authenticated. No se encontraron migraciones operativas que cambien a esos roles para hacer DDL; los SET ROLE de pruebas sintéticas no son consumidores de producción. No es un inventario de jobs o clientes externos no incluidos en el repositorio.

`server/supabase/serverClient.ts` usa clave pública y cookies de sesión; `server/supabase/adminClient.ts` usa la clave de servicio. El permiso de una petición autenticada proviene del JWT de usuario, no del nombre de la variable de clave pública. Los controles de rol internos a las RPC se mantienen.

## Cambios propuestos

Repair separado: `sql/repairs/20260910_finance_table_grants.PROPOSAL.sql`.

1. Revocar TRUNCATE, TRIGGER, REFERENCES y MAINTAIN a anon/authenticated en ambas tablas.
2. Revocar INSERT y DELETE de cuentas a ambos roles. UPDATE ya estaba ausente; no se añade una revocación sin efecto. Los tres permisos de escritura de movimientos ya estaban ausentes.
3. Revocar SELECT de anon en ambas tablas: no se encontró una funcionalidad anónima dependiente. Una lectura anónima pasará de resultado vacío filtrado por RLS a error de permisos; confirmar que ningún monitor externo dependa de ese 200.
4. Conservar SELECT de authenticated en ambas tablas, condicionado por las políticas actuales; conservar EXECUTE de RPC, propietarios, service_role y políticas sin cambios.
5. Verificar dentro de la transacción que la capacidad efectiva final sea exactamente SELECT para authenticated y ninguna para anon. Si PUBLIC/herencia concede algo más, el repair falla y debe terminar en ROLLBACK; no aplica CASCADE ni revoca permisos a ciegas.

`MAINTAIN` es una capacidad administrativa de mantenimiento; no hace falta para una consulta SELECT. TRIGGER permite crear triggers y REFERENCES crear FK; su revocación no elimina objetos ya creados. [Privilegios PostgreSQL](https://www.postgresql.org/docs/current/ddl-priv.html). RLS no cubre TRUNCATE ni REFERENCES. [RLS PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

No hay una dependencia estricta entre sanear estos grants históricos y crear el CHECK/RPC recurrente; no se mezcla el repair con `20260909_01_recurring_payments.sql`.

## Impacto del CHECK en despliegue

La implementación funcional actual toma ACCESS EXCLUSIVE sobre finance_cash_movements antes de sustituir sus CHECK de movement_type. Bloquea SELECT, INSERT, UPDATE y DELETE de otras transacciones: pagos de proveedor, reembolsos, entradas de tesorería y cualquier operación que necesite ese ledger pueden esperar. Una solicitud exclusiva en cola también puede hacer esperar consultas posteriores.

El lock se mantiene desde su adquisición hasta el COMMIT final (o ROLLBACK), incluyendo el resto de CREATE FUNCTION/GRANT/DDL de esa transacción; salir del DO no lo libera. El CHECK normal puede escanear las filas bajo ese lock. La instantánea anterior tenía cero movimientos, pero eso no garantiza ni cero filas ni ausencia de transacciones largas el día del despliegue. Los ALTER TABLE previos de la misma migración también bloquean tablas unlinked y sus FK de cuentas; no atribuir toda la indisponibilidad al ledger. [Bloqueos PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

Alternativas propuestas, sin aplicarlas ni reescribir ahora la migración funcional:

- Cambio pequeño: trasladar el bloque del CHECK al final, inmediatamente antes de NOTIFY/COMMIT, para reducir el trabajo posterior con el lock exclusivo. No elimina el escaneo ni los demás locks de la transacción.
- Para tabla grande: preparar un CHECK nuevo equivalente a `(predicado_anterior) OR movement_type='unlinked_payment'` con NOT VALID mientras sigue vigente el anterior; COMMIT. Validarlo en otra transacción con SHARE UPDATE EXCLUSIVE; COMMIT. En una última transacción breve, eliminar el anterior y renombrar el nuevo. Repetir preservando cada predicado existente, sin listas fijas. Solo habilitar el nuevo flujo después del cambio final. El CHECK antiguo protege la fase intermedia; el nuevo también se aplica a filas nuevas aunque esté NOT VALID. La estrategia necesita scripts y ensayo propios, y no debe ejecutarse además del bloque actual sin adaptar la secuencia.
- NOT VALID y VALIDATE en la misma transacción que obtuvo ACCESS EXCLUSIVE no reducen el nivel de lock retenido. [ALTER TABLE PostgreSQL](https://www.postgresql.org/docs/current/sql-altertable.html).

Mantener la implementación actual es razonable en una ventana controlada con actividad financiera pausada, ausencia de transacciones largas, lock_timeout acotado y cliente que cierre con ROLLBACK si falla. No se ha medido duración real ni se promete un número de milisegundos. No dejar la transacción abierta mientras se revisa manualmente SQL. Un intento que supere lock_timeout debe abortar y revisarse, no reintentarse automáticamente.

## Riesgos todavía abiertos

- No se obtuvo OpenAPI público ni se probó una sesión HTTP autenticada: no se certifica toda la superficie administrada ni explotabilidad de TRUNCATE.
- No se dispone de inventario de consumidores externos, monitores y procesos de mantenimiento fuera del repositorio. Confirmarlos antes de revocar SELECT anónimo o MAINTAIN.
- El SELECT de movimientos no tiene política que conceda filas en la instantánea revisada; se conserva el estado previo, sin abrir una política nueva.
- No se ha encontrado una inversión explícita de locks en las funciones revisadas, pero no está certificada la ausencia global de deadlocks porque faltan pruebas concurrentes reales y un análisis completo de triggers, claves foráneas y llamadas externas a finance_*. No se modificaron RPC ajenas.

## Pruebas y archivos

`node scripts/test-cash-privileges-repair.mjs`: PASS en PGlite sintético. Aplica el repair exacto con los grants iniciales observados; verifica SELECT/RLS admin/accounting/logistics, usuario normal sin filas, anon sin lectura, DML/TRUNCATE directos denegados, RPC real finance_set_operating_cash_account para admin/accounting, conservación de trigger existente, FK y service_role. No mide concurrencia ni ejecuta pagos.

Archivos creados/modificados en esta revisión:
- Este informe y RECURRING_PAYMENTS_LOCAL_IMPLEMENTATION.md (referencia a esta revisión y descripción actualizada del repair).
- sql/diagnostics/20260910_cash_privileges_surface_readonly.sql: consultas adicionales de catálogo.
- sql/repairs/20260910_finance_table_grants.PROPOSAL.sql: repair mínimo con MAINTAIN, SELECT anónimo y comprobación efectiva final.
- scripts/test-cash-privileges-repair.mjs: prueba enfocada nueva.
- scripts/test-recurring-payments-db.mjs: actualización de su fixture de grants y expectativa SELECT anónimo para concordar con el repair revisado; no se repite aquí la suite financiera cerrada.

No se modificó la migración funcional, el error TypeScript de inventario, ni datos/permisos de producción. Los scripts/resultados auxiliares de inspección quedan en .codex-work; no contienen claves de conexión en sus resultados.

## Acciones manuales antes del despliegue

1. Confirmar con el responsable de infraestructura que ningún consumidor externo usa anon/authenticated para mantenimiento/DDL o depende de SELECT anónimo en estas tablas; confirmar configuración gestionada de PostgREST si se requiere certificar toda la superficie.
2. Revisar el repair separado y autorizar expresamente su ejecución; guardar las ACL actuales para reversión revisada. Ejecutarlo solo con rol administrativo adecuado y finalizar COMMIT o ROLLBACK; nunca dejar un error con transacción abierta.
3. Elegir ventana controlada o preparar/ensayar la alternativa de CHECK por fases. Antes de aplicar comprobar actividad y transacciones largas, fijar lock_timeout/statement_timeout adecuados y pausar escritores relevantes. No repetir por rutina el preflight de RLS unlinked ya cerrado.
4. Tras la ejecución autorizada, comprobar solo las postcondiciones cambiadas: privileges efectivos, lectura autenticada de cuentas, RPC autorizadas en un entorno de ensayo, CHECK validado y compatibilidad del nuevo tipo. Para pagos reales se requiere una autorización específica distinta de esta revisión.
