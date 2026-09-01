# ERP BFF Network Boundary

Esta regla es una restricción para desarrollo nuevo y cambios futuros. No
autoriza ni exige una refactorización global de las excepciones existentes.

## Regla arquitectónica

Las funcionalidades operativas del ERP deben usar nuestro backend Next.js como
BFF para acceder a datos empresariales y servicios externos.

Patrón preferido:

```text
Browser
  -> Next.js /api/*
  -> servicio/repository server-side
  -> Supabase / Amazon / Google Drive / otros terceros
```

- Evitar introducir nuevas dependencias browser-directas hacia terceros cuando
  puedan afectar la operación del ERP.
- Las excepciones browser-directas existentes actualmente —Supabase Auth,
  algunas URLs públicas de Storage, Google Drive y enlaces auxiliares— no deben
  refactorizarse globalmente ahora. Son puntos de arquitectura pendientes de
  validar antes del despliegue con acceso desde China.
- Amazon SP-API debe permanecer exclusivamente server-side/background.
- Nunca exponer secretos server-side al cliente.

