# sql/

Carpeta de scripts SQL del proyecto. Contiene dos subcarpetas con responsabilidades distintas.

---

## Estructura

```
sql/
├── migrations/      Scripts que modifican el esquema o los datos de Supabase
└── diagnostics/     Consultas de solo lectura para inspeccionar el estado de la BD
```

---

## migrations/

Scripts DDL, DML y de configuración que crean o alteran el esquema, añaden
columnas, aplican constraints, crean triggers, vistas, funciones, políticas RLS
o normalizan datos existentes.

**No todos los scripts de esta carpeta deben ejecutarse automáticamente.**
Varios son incrementales (alinean una tabla que ya existía antes de que se
creara el script canónico), correcciones puntuales aplicadas en su momento, o
backfills que solo tienen sentido la primera vez. Ejecutarlos de nuevo podría
ser inofensivo (la mayoría usa `IF NOT EXISTS` / `IF EXISTS`) pero algunos
contienen `UPDATE` o `DELETE` reales que no son idempotentes si los datos ya
están normalizados.

### Antes de ejecutar una migración

1. Confirmar en Supabase si la migración ya está aplicada (verificar columnas,
   constraints, policies o datos con el diagnóstico correspondiente).
2. Revisar la sección de clasificación en `migrations/README.md` para saber si
   el script es vigente, histórico, manual o dudoso.
3. Para scripts de la categoría **MANUALES / BACKFILL / FIXES TEMPORALES**:
   ejecutar siempre el diagnóstico previo correspondiente.

---

## diagnostics/

Consultas `SELECT` (o en algún caso `UPDATE` claramente marcado como dry-run)
para inspeccionar el estado de la base de datos sin modificar el esquema.

Los scripts de esta carpeta **no modifican datos a menos que el propio fichero
lo indique explícitamente** (caso `orden_items_cbm_cero_backfill.sql` y el paso
de fusión en `normalize_ventas_diarias_marketplace_id.sql`, que deben
considerarse scripts manuales, no diagnósticos puros).

---

## Regla general

| Tipo de script          | ¿Se ejecuta automáticamente? | ¿Requiere revisión previa? |
|-------------------------|------------------------------|----------------------------|
| Vigente / canónico      | No (manual, una vez)         | Sí, verificar si ya existe |
| Histórico / absorbido   | No                           | Solo si BD está muy antigua |
| Manual / backfill       | No                           | Sí, siempre                 |
| Dudoso                  | No                           | Sí, requiere análisis       |
| Diagnóstico             | No (lectura)                 | No                          |
