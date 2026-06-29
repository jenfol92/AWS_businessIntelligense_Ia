# Amazon SP-API Scheduler Cron

## Endpoint programado

`GET /api/cron/amazon/reports/run`

Orden de ejecucion:

1. Poll de informes pendientes.
2. Preview de informes `DONE` con `report_document_id`.
3. Request de schedules vencidos.
4. Listado de jobs listos para commit manual.

Este endpoint no hace commit automatico y no importa stock.

## Frecuencia

Vercel ejecuta el endpoint cada hora:

```cron
0 * * * *
```

La frecuencia real de solicitud de informes se controla en base de datos con
`amazon_report_schedules.frequency_minutes`, por lo que ejecutar el cron cada hora
no fuerza solicitudes duplicadas.

## Variables necesarias

`CRON_SECRET`

Protege el endpoint. La llamada debe enviar:

```txt
Authorization: Bearer ${CRON_SECRET}
```

`AMAZON_REPORT_SCHEDULER_ENABLED`

Si vale `false`, el endpoint responde como desactivado y no ejecuta el scheduler.
Si no existe o tiene otro valor, el scheduler queda habilitado.

## Prueba manual

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Method GET -Uri "http://localhost:3000/api/cron/amazon/reports/run" -Headers $headers
```

## Commit manual

El commit sigue siendo explicito por `jobId`:

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET"; "Content-Type" = "application/json" }
$body = @{ jobId = "JOB_ID" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/cron/amazon/reports/commit" -Headers $headers -Body $body
```
