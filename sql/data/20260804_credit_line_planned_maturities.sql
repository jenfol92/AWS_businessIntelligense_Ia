BEGIN;

CREATE TEMP TABLE credit_line_planned_maturities_incoming
  (LIKE public.finance_credit_line_planned_maturities INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
  ON COMMIT DROP;

INSERT INTO credit_line_planned_maturities_incoming
  (id,credit_line_id,due_date,planned_principal_eur,expected_interest_eur,expected_fees_eur,concept,reference,source_type,source_key,status)
VALUES
-- Caja Rural
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-03',22000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-03:22000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-10',27800,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-10:27800.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-14',50000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-14:50000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-20',20000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-20:20000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-20',26000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-20:26000.00:2','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-27',40000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-08-27:40000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-05',54700,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-09-05:54700.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-14',21400,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-09-14:21400.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-15',15829,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-09-15:15829.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-25',28000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-09-25:28000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-02',68000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-10-02:68000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-06',35000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-10-06:35000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-15',40000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-10-15:40000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-23',37100,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-10-23:37100.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-02',21500,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-11-02:21500.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-06',40000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-11-06:40000.00:1','planned'),
(gen_random_uuid(),'8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-10',41000,0,0,'Devolución de crédito – Caja Rural','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:caja-rural:2026-11-10:41000.00:1','planned'),
-- La Caixa
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-18',25000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-08-18:25000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-21',20000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-08-21:20000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-24',24000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-08-24:24000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-25',40000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-08-25:40000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-09-04',30000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-09-04:30000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-10-09',30000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-10-09:30000.00:1','planned'),
(gen_random_uuid(),'a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-10-19',27000,0,0,'Devolución de crédito – La Caixa','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:la-caixa:2026-10-19:27000.00:1','planned'),
-- BBVA
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-28',44000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-07-28:44000.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-28',8300,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-07-28:8300.00:2','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-31',8300,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-07-31:8300.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-08-17',6000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-08-17:6000.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-08-28',8300,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-08-28:8300.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-02',60000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-09-02:60000.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-07',40000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-09-07:40000.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-23',17000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-09-23:17000.00:1','planned'),
(gen_random_uuid(),'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-10-23',17000,0,0,'Devolución de crédito – BBVA','Calendario líneas bancarias 2026','spreadsheet_schedule','credit-maturity:bbva:2026-10-23:17000.00:1','planned')
;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM credit_line_planned_maturities_incoming i
    JOIN public.finance_credit_line_planned_maturities e USING(source_key)
    WHERE e.credit_line_id<>i.credit_line_id OR e.due_date<>i.due_date
       OR e.planned_principal_eur<>i.planned_principal_eur
       OR e.expected_interest_eur<>i.expected_interest_eur
       OR e.expected_fees_eur<>i.expected_fees_eur
       OR e.concept<>i.concept OR coalesce(e.reference,'')<>coalesce(i.reference,'')
       OR e.source_type<>i.source_type
  ) THEN
    RAISE EXCEPTION 'PLANNED_MATURITY_SOURCE_CONFLICT';
  END IF;
END $$;

INSERT INTO public.finance_credit_line_planned_maturities
  (id,credit_line_id,due_date,planned_principal_eur,expected_interest_eur,expected_fees_eur,concept,reference,source_type,source_key,status)
SELECT id,credit_line_id,due_date,planned_principal_eur,expected_interest_eur,expected_fees_eur,concept,reference,source_type,source_key,status
FROM credit_line_planned_maturities_incoming
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
