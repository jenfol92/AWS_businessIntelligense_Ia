-- Fail closed where the repository does not define all mandatory catalogue metadata.
-- Existing IDs and country UUIDs are never replaced. Run only after schema review.
BEGIN;
DO $$
DECLARE entry record; country public.paises; existing public.amazon_marketplaces; missing_required text;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('BE','AMEN7PMS3EDWL'),('NL','A1805IZSGTT6HS'),('IE','A28R8C7NBKEWEA'),
    ('AE','A2VIGQ35RCS4UG'),('SA','A17E79C6D8DWNP')
  ) AS required(code,id) LOOP
    SELECT * INTO country FROM public.paises WHERE code=entry.code;
    IF NOT FOUND OR country.id IS NULL THEN
      RAISE EXCEPTION 'REQUIERE VERIFICACIÓN EN PRODUCCIÓN: paises.code=% absent or missing id',entry.code;
    END IF;
    SELECT * INTO existing FROM public.amazon_marketplaces WHERE id=entry.id;
    IF FOUND THEN
      IF existing.code IS DISTINCT FROM entry.code OR (existing.pais_id IS NOT NULL AND existing.pais_id<>country.id) THEN
        RAISE EXCEPTION 'Marketplace identity conflict: %',entry.code;
      END IF;
      UPDATE public.amazon_marketplaces SET pais_id=country.id WHERE id=entry.id AND pais_id IS NULL;
    ELSE
      IF EXISTS(SELECT 1 FROM public.amazon_marketplaces WHERE code=entry.code) THEN
        RAISE EXCEPTION 'Marketplace code has another ID: %',entry.code;
      END IF;
      SELECT string_agg(column_name,', ') INTO missing_required FROM information_schema.columns
        WHERE table_schema='public' AND table_name='amazon_marketplaces' AND is_nullable='NO'
          AND column_default IS NULL AND is_identity='NO' AND is_generated='NEVER'
          AND column_name NOT IN ('id','code','name','currency','pais_id');
      IF missing_required IS NOT NULL THEN
        RAISE EXCEPTION 'REQUIERE VERIFICACIÓN EN PRODUCCIÓN: catalogue metadata without a repo-defined default: %',missing_required;
      END IF;
      INSERT INTO public.amazon_marketplaces(id,code,name,currency,pais_id)
        VALUES(entry.id,entry.code,country.name,country.currency,country.id);
    END IF;
  END LOOP;
END $$;
COMMIT;
