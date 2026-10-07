# Operación FBM dedicada — propuesta preparada, no activada

No ejecutar una prueba Amazon, arrancar el worker, desplegar ni cambiar flags hasta la autorización posterior a la revisión.
No reabrir jobs FAILED ni reutilizar documentos del job histórico fallido. No hay migración SQL.

## Identidades y publicación

CREATE conserva el universo original en `raw.fbm.identityKey`. PUBLISH compara ese universo con productos actuales,
antes y después de descargar el report. Solo una baja explícita `estado=descatalogado`, mismo producto/SKU y
identidad válida, queda reconciliada. Desapariciones, altas, cambios de SKU, duplicados, identidad inválida y un
universo completamente vacío bloquean. `raw.fbm.identityReconciliation` conserva pares producto/SKU y categorías,
sin nombres, datos personales, tokens ni URLs firmadas. No se altera la identidad original.

La cobertura, duplicados y cantidades se validan sobre los activos reconciliados. Ninguna ausencia se convierte
en cero. La RPC existente inserta run y filas en una transacción; el snapshot anterior permanece visible si falla.
La reconciliación no es un bloqueo transaccional del catálogo: existe el mismo intervalo entre la última lectura
de productos y el commit. Resolver ese intervalo absolutamente requeriría otro alcance SQL; no se añade aquí.

## Generación y recovery

* Generación diaria: GET o POST `/api/cron/amazon/fbm-inventory-snapshot/generate`.
  Bearer CRON_SECRET y `AMAZON_FBM_REPORTS_SYNC_ENABLED=true`.
  Solo inicia si no existe job, o el último está COMPLETED, terminó hace al menos cinco minutos y su CREATE
  corresponde a un día UTC anterior. No avanza pendientes y no reemplaza terminales fallidos/inciertos.
  El claim y la lease persistidos del coordinador hacen idempotentes los inicios concurrentes.
* Recovery: GET o POST `/api/cron/amazon/fbm-inventory-snapshot/recover`.
  Bearer CRON_SECRET. Habilitado por manual o generación. Continúa el job existente, una fase por tick;
  respeta lease y nextAttemptAt. FAILED/COMPLETED son inertes. Puede ejecutar CREATE de un job existente
  que aún no tiene report; nunca crea una nueva generación.
* Manual: POST `/api/amazon/inventory/fbm-snapshot/import`, sesión autenticada y flag manual habilitado.
  El botón conserva START + OBSERVE; no hace polling por POST. Retry explícito de terminal fallido crea
  un sucesor y report nuevos. El job fallido original permanece intacto.
* El endpoint cron POST anterior sigue disponible para callers existentes. Para automatización diaria usar
  exclusivamente la nueva ruta `generate`, que aplica la política diaria.

El plazo técnico de cinco minutos no es la frecuencia de generación. No se usa el scheduler compartido.

## Scheduling preparado

`vercel.json` añade únicamente generación FBM a las 04:05 UTC (`5 4 * * *`), sin cambiar los otros cron.
Vercel invoca GET. Hobby solo permite frecuencia diaria; Pro/Enterprise permiten frecuencia por minuto:
https://vercel.com/docs/cron-jobs/usage-and-pricing
El plan real y el despliegue no están verificados. No se registra un cron frecuente con esa incertidumbre.
La entrada diaria por sí sola NO garantiza recovery.

Para una instancia con servidor siempre encendido se prepara el proceso externo:

```powershell
node scripts/run-fbm-worker.mjs --serve
```

Ejecutar desde la raíz del proyecto con las credenciales existentes. `FBM_WORKER_BASE_URL` es opcional;
por defecto usa localhost:3000. HTTP solo se permite en loopback; destinos remotos requieren HTTPS.
Configurar supervisión/reinicio automático del proceso en la infraestructura elegida, no en el navegador.
No está arrancado ni instalado como servicio en esta implementación.

Cada tick secuencial consulta generación elegible y recovery, y espera 60 segundos al terminar.
La generación puede consultar su gate cada tick, pero solo crea una generación por día UTC según estado persistido.
Completar hoy un report antiguo permite solicitar evidencia de hoy después del cooldown, sin esperar otro día.
Dos workers son tolerados por claim/CAS. No hay replay HTTP dentro de un tick. Errores transitorios se observan
en el siguiente tick; terminales requieren revisión, no un report nuevo automático.

Si se confirma Pro/Enterprise puede sustituirse el worker por un cron dedicado recovery `*/5 * * * *`.
Si solo existe Hobby sin servidor, hace falta un scheduler externo con disponibilidad y cuotas verificadas;
no asumir que el cron diario resolverá la continuación. No activar ambos mecanismos innecesariamente.

## Catálogo

El catálogo añade `publishedFbm` sin romper los campos existentes. Tras filtrar/paginar consulta en un lote la
vista `v_latest_amazon_fbm_inventory_by_product`, exclusivamente ES y IDs visibles. No hace N+1 ni lee jobs,
reports no publicados o Amazon. Desktop/móvil muestran cantidad publicada y observed_at; ausencia/fallo
se muestra como desconocido, nunca como cero o stock legacy. FBA, stock total y fórmulas existentes se conservan.
Verificar en la prueba autenticada que los grants de la vista permiten esa lectura. No se cambian permisos.

## Primera prueba real, solo con autorización

1. Revisar diff/tests y elegir scheduler/entorno. Comprobar flags efectivos y CRON_SECRET sin exponerlos.
2. Desplegar la versión revisada y activar exclusivamente recovery dedicado/worker elegido.
3. Leer último job; conservar FAILED histórico. Pulsar Actualizar FBM una vez: el retry soportado crea sucesor.
4. Confirmar nuevo jobId/reportId. Observar GET; esperar que ticks del servidor hagan POLL y PUBLISH.
5. Comprobar job COMPLETED, run COMPLETE/publication_ready, recuentos de cobertura y filas reales.
6. Comprobar ALAIA por producto/SKU/ASIN/ES y la cantidad real del report nuevo, sin cifra esperada fija.
7. Comprobar catálogo con sesión: mismo stock publicado y fecha; cerrar pestaña no detiene el worker.
8. Confirmar que no hubo llamadas/rutas FBA. No usar el scheduler compartido.

## Rollback

Detener exclusivamente el worker/cron FBM activado y restaurar los archivos de esta entrega desde la copia
previa a los cambios, conservando el resto del worktree. No hacer git reset global: había trabajo previo y
varios archivos FBM ya eran untracked. No eliminar ni editar jobs o snapshots publicados.
La nueva metadata raw es opcional y compatible con el código anterior. El rollback no deshace datos publicados.
