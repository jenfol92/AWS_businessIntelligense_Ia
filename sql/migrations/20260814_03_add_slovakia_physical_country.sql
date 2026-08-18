BEGIN;

INSERT INTO public.paises (code, name, currency, activo)
VALUES ('SK', 'Eslovaquia', 'EUR', true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
