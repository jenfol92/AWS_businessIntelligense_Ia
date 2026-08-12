import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync(new URL("./buildFinancialPlanning.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../components/FinancialPlanningPage.tsx", import.meta.url), "utf8");
const repository = readFileSync(new URL("../repositories/financialPlanningRepository.ts", import.meta.url), "utf8");
const conversion = readFileSync(new URL("../../../sql/migrations/20260808_03_convert_spreadsheet_schedule_to_legacy_debt.sql", import.meta.url), "utf8");
const initialization = readFileSync(new URL("../../../sql/migrations/20260808_04_initialize_legacy_debt.sql", import.meta.url), "utf8");

test("legacy repayment groups are real chronological maturities, never planned maturities", () => {
  assert.match(builder, /group\["group_origin_type"\] === "legacy_regularization"/);
  assert.match(builder, /type: "credit_line_maturity"/);
  assert.match(builder, /month: dateToMonth\(dueDate\)/);
  assert.match(repository, /\.neq\("source_type", "spreadsheet_schedule"\)/);
});

test("legacy cards expose costs, state and the single payment action", () => {
  assert.match(page, /CRÉDITO · DEUDA INICIAL/);
  assert.match(page, /Principal \{isCreditLineMaturity \? "pendiente" : "pagado"\}/);
  assert.match(page, /Intereses conocidos/);
  assert.match(page, /Comisiones conocidas/);
  assert.match(page, /parcialmente pagado/);
  assert.equal((page.match(/Pagar y liberar/g) ?? []).length, 2);
});

test("legacy principal is in Lines while known costs affect projected cash and treasury", () => {
  assert.match(builder, /eventCategory\(event\)/);
  assert.match(builder, /pending\[category\] \+= event\.plannedAmountEur/);
  assert.match(builder, /projectedCash -= event\.plannedAmountEur \+ \(event\.expectedInterestEur \?\? 0\) \+ \(event\.expectedFeesEur \?\? 0\)/);
  assert.match(builder, /event\.type==="credit_line_maturity"\?event\.plannedAmountEur\+\(event\.expectedInterestEur\?\?0\)\+\(event\.expectedFeesEur\?\?0\)/);
});

test("overdue legacy cards remain visible in the first planning bucket", () => {
  assert.match(builder, /index === 0[\s\S]*event\.type === "credit_line_maturity"[\s\S]*event\.isLegacyOpeningBalance[\s\S]*event\.date < horizonStart/);
});

test("legacy opening is migrated from the historical schedule without a manual form", () => {
  assert.match(builder, /unexplained > 0\.01/);
  assert.match(page, /Deuda inicial pendiente de migración:/);
  assert.doesNotMatch(page, /Configurar deuda inicial/);
  assert.doesNotMatch(page, /LegacyRegularizationForm/);
  assert.match(conversion, /group_origin_type, group_origin_id/);
  assert.match(conversion, /'legacy_regularization', v_regularization_id/);
  assert.match(conversion, /linked_repayment_group_id = v_group_id/);
  assert.match(conversion, /row\(33::bigint, 33::bigint, 993229::numeric\)/);
});

test("remote legacy opening is self-contained, exact and independent from planned maturities", () => {
  assert.doesNotMatch(initialization, /finance_credit_line_planned_maturities/i);
  assert.doesNotMatch(initialization, /spreadsheet_schedule/i);
  assert.doesNotMatch(initialization, /drawdown/i);
  assert.doesNotMatch(initialization, /finance_cash/i);
  assert.equal((initialization.match(/'credit-maturity:/g) ?? []).length, 33);
  assert.match(initialization, /row\(33::bigint,33::bigint,993229::numeric\)/);
  assert.match(initialization, /v_mode:='validate'/);
  assert.match(initialization, /LEGACY_INITIALIZATION_PARTIAL_OR_INCOMPATIBLE/);
  assert.match(initialization, /LEGACY_INITIALIZATION_POSTCHECK_DUPLICATE/);
  assert.match(initialization, /'legacy_regularization',v_regularization_id/);
  assert.match(initialization, /'adjustment'/);
});
