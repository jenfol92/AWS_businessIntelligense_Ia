# Pagos recurrentes: implementación local

2026-09-10. Implementación local revisada. No se ha aplicado SQL en Supabase ni ejecutado pagos reales.

## Funcionamiento

- Crear pago ofrece vinculado, parcial (importe libre aplicado a obligaciones existentes) y recurrente.
- Recurrente permite una vez, mensual, trimestral o anual, con finalización opcional, cuenta EUR y tipos personalizados.
- Tipos iniciales: Seguridad Social, Salarios, IVA y Otros. Los tipos propios se guardan en `finance_payment_types`; su categoría general sigue siendo `other`.
- Se reutilizan obligaciones, cuotas, pagos y ledger de caja existentes. Las futuras cuotas no materializadas se proyectan mediante una lectura; al pagar se materializa únicamente la cuota seleccionada. El GET recurrente no escribe.
- Guardar pendiente no cambia saldo. Registrar pagado crea movimiento/asignación y descuenta la cuenta en una transacción idempotente. No ejecuta transferencias bancarias.
- Los nuevos pagos se suman en Otros: pendientes por vencimiento y pagados por fecha efectiva. Los atrasados recurrentes aparecen en el primer mes visible.
- Depósitos y balances usan el cambio previsto del pago o, si falta, el de la orden de la misma moneda. La confirmación de órdenes ya guardaba ese campo. No se sobrescriben cambios reales ni se regularizan órdenes antiguas automáticamente.
- Sin cambio: se muestran importes originales separados por moneda y total EUR parcial.
- Actualizar muestra progreso y errores, conservando la política existente de frescura Amazon. Pulsarlo puede activar la sincronización Amazon si los datos son antiguos.

## Activación pendiente

Revisar el esquema real y aplicar por separado `sql/migrations/20260909_01_recurring_payments.sql` tras las migraciones existentes de obligaciones no vinculadas y caja. No se ejecuta automáticamente. Mientras falte, la pantalla muestra un aviso y no permite operar el formulario sin catálogo.

La migración añade tipo, cuenta prevista y clave de creación a las tablas canónicas; admite finalización nula y añade RPC de creación, pago y lectura. No modifica saldos históricos. La lectura agrega JSON para evitar que el límite de filas de PostgREST recorte los totales.

## Verificación

- TypeScript: `npx.cmd tsc --noEmit`.
- Servicios financieros: `node --test modules/finance/services/*.test.mjs`, 216 pruebas.
- SQL: `node scripts/test-recurring-payments-db.mjs`, PostgreSQL aislado PGlite con migraciones reales de obligaciones y fixtures de cuenta/identidad. Comprueba fin de mes, recurrencias, permisos, tipos, pagos parciales, sobrepagos, rollback e idempotencia. No demuestra concurrencia entre conexiones ni verifica el esquema desplegado.
- Next: la revisión inicial del 09/09 compiló en copia temporal sin `.env.local`. En la revisión del 10/09, el chequeo de tipos de finanzas pasa; el chequeo global encontró TS2554 en `modules/inventory/services/buildInventoryForecastPanel.ts:150`, fuera de esta modificación. No se presenta el build anterior como validación de la revisión nueva.
- Pendiente: comprobación de la interfaz conectada al esquema desplegado después de aplicar la migración con autorización.

La dependencia de prueba PGlite está aislada en `.codex-work/finance-validation`; no se cambiaron `package.json` ni `package-lock.json`.

## Alertas corregidas el 10/09

- Se guarda la operación antes del POST en el navegador, por proyecto y usuario. No caduca mientras sea incierta. Web Locks serializa la reserva entre pestañas. Un error de almacenamiento impide enviar una operación nueva.
- Mientras el resultado sea incierto, cerrar y Escape están bloqueados. Tras recargar se recupera la misma operación. `Comprobar estado` es una lectura autorizada; `not_found` no elimina la clave ni demuestra que una petición todavía en curso no vaya a ejecutarse.
- El reintento conserva UUID y petición. Solo una respuesta confirmada elimina la operación; el primer intento rechazado con certeza por validación/rollback permite corregir el formulario. Un rechazo después de una respuesta incierta conserva la operación.
- El servidor guarda SHA256 del JSON normalizado, no una copia adicional del payload. JSONB ordena las claves y se normalizan escala numérica y campos nulos. El navegador conserva temporalmente la petición necesaria para el reintento y la elimina al resolverla.
- La migración amplía los CHECK existentes de `movement_type` con OR `unlinked_payment`, sin reconstruir una lista fija. Si encuentra una condición que combina columnas o no encuentra la restricción, aborta para revisión. El script de diagnóstico de solo lectura está preparado en `sql/diagnostics/recurring_payments_preflight_readonly.sql`; no se ha ejecutado en producción.
- Las pruebas SQL usan las funciones de permisos del repositorio con `SET ROLE authenticated`: admin/accounting permitidos, logistics/normal/sin rol/desconocido denegados, user_metadata no concede permisos. Anon carece de EXECUTE; service_role continúa como rol técnico autorizado. Esto no verifica qué definición esté desplegada en producción.
- Las RPC validan JSON antes de convertirlo y capturan conversiones inválidas con SQLSTATE 22023; la API presenta errores controlados.
- Fechas contables y ventana mensual: `Europe/Madrid` explícita en cliente y servidor; los timestamps de pagos recurrentes se escriben y leen con esa zona. Se prueban medianoche y cambios de horario.
- FX previsto del pago: `source=payment`; FX previsto de la orden: `source=order`. Se conserva la convención moneda extranjera por EUR.
- `scripts/test-recurring-payments-ui.cjs` monta el modal real en Chrome con un servidor HTTP sintético. Comprueba cierre/Escape, recarga, not_found, consulta confirmada y dos pestañas/reintento. No accede a cuentas ni API reales. Usa Playwright del runtime a través de `FINANCE_PLAYWRIGHT_MODULE`.


## Revisión del 10 de septiembre: rango, RLS y bloqueos

Calendario: las proyecciones empiezan directamente en el primer mes del intervalo, alineado con la frecuencia original; no se generan meses desde 2022 para una consulta de 2026. Las cuotas persistidas con saldo pendiente se conservan aunque sean anteriores a p_from: date conserva el vencimiento real, display_date = greatest(date,p_from), y el cliente agrupa por display_date. No se inventan deudas históricas no materializadas durante una lectura. Esta distinción es intencionada: añadir date >= p_from a todas las cuotas ocultaría deudas reales.

Materialización corregida: el pago y la creación invocan finance_materialize_recurring_payment, helper privado que comparte el lock de plantilla del generador antiguo, valida frecuencia/ancla/fechas y crea solamente la ocurrencia seleccionada. La prueba con inicio en 2022 confirma una única obligación nueva y un único cargo tras reintento. El generador antiguo sigue disponible para sus otros consumidores.

Estado de operación: se mantiene visibilidad compartida para admin/accounting/service_role. El aislamiento del navegador por usuario evita mezclar reintentos; no define propiedad exclusiva del registro financiero.

Preflight ejecutado contra joqktmejdxkqrzncvxin mediante DATABASE_URL verificada, en READ ONLY, finalizado con ROLLBACK. Cero escrituras y cero migraciones aplicadas. Evidencia local: .codex-work/finance-preflight-result.json.
- Las siete tablas solicitadas tienen RLS activo y FORCE RLS desactivado.
- Los cinco objetos unlinked permiten a authenticated SELECT sujeto a finance_can_read_unlinked_details; sin permisos de escritura directa ni grants a anon en esas tablas.
- La función de detalle/gestión acepta admin/accounting/service_role, desde app_metadata. Logística puede leer tesorería general (incluidas cuentas), pero no detalles unlinked. No afirmar que logística no puede acceder a ningún dato financiero.
- Cuentas y movimientos conservan grants TRUNCATE a anon/authenticated. RLS no protege TRUNCATE. Hay que revisar y revocar esos privilegios heredados antes de certificar permisos globales; no se ejecutó ninguna prueba destructiva ni se demostró una vía HTTP explotable.
- También existen políticas antiguas de proveedor y compras con qual=true; los permisos efectivos requieren evaluar conjuntamente grants y políticas. FORCE RLS=false no permite afirmar que service_role sea el único bypass: propietarios/superusuarios también cuentan.
- El CHECK actual contiene los cinco tipos originales y estaba validado; movimientos tenía cero filas en esta instantánea. La migración preserva el predicado y requiere una ventana controlada por ACCESS EXCLUSIVE.

Revisión de las 49 definiciones finance_* desplegadas y del SQL nuevo: planificación/cancelación unlinked bloquean obligación -> cuotas; el nuevo pago sigue obligación -> cuota -> cuenta, con plantilla primero si materializa. Reembolso de crédito v2 bloquea línea -> grupo -> cuenta; refinanciación bloquea líneas ordenadas por UUID -> grupo; proveedor bloquea pago -> cuenta en la rama de caja. No se encontró una ruta explícita cuenta -> cuota unlinked -> obligación en esas funciones. Esto no certifica ausencia global de deadlocks: faltan pruebas concurrentes y análisis exhaustivo de triggers, claves foráneas y llamadas fuera de finance_*. No se modificaron otras RPC financieras.

Validación actual: prueba PostgreSQL sintética pasada (incluye plantilla iniciada en 2022, seis meses proyectados y atraso persistido con fecha de presentación); 12 pruebas específicas pasadas; TypeScript financiero pasado. El error global de inventario queda separado.

Propuesta local de mínimo privilegio: sql/repairs/20260910_finance_table_grants.PROPOSAL.sql revoca TRUNCATE/TRIGGER/REFERENCES/MAINTAIN de cuentas y movimientos para anon/authenticated, INSERT/DELETE de cuentas y SELECT anónimo. Conserva SELECT de authenticated y service_role. No aplicada. No pretende sanear las demás tablas financieras. La nueva tabla finance_payment_types revoca explícitamente grants heredados antes de conceder SELECT/INSERT a authenticated sujetos a RLS. Ambas reglas se prueban en PostgreSQL sintético con grants amplios previos.

Revisión de impacto y superficie efectiva: ver CASH_PRIVILEGES_AND_CHECK_DEPLOYMENT_REVIEW.md. Esa revisión utiliza el preflight existente y consultas adicionales dirigidas; no modifica la migración funcional ni aplica el repair.
