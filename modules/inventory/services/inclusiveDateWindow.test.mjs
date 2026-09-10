import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildInclusiveDateWindow,
  isDateInInclusiveWindow,
} from "./inclusiveDateWindow.ts";

test("inclusive windows contain exactly N calendar dates", () => {
  assert.deepEqual(buildInclusiveDateWindow("2026-09-01", 1), {
    fromDate: "2026-09-01",
    toDate: "2026-09-01",
  });
  assert.deepEqual(buildInclusiveDateWindow("2026-09-01", 7), {
    fromDate: "2026-08-26",
    toDate: "2026-09-01",
  });
  assert.deepEqual(buildInclusiveDateWindow("2026-09-01", 30), {
    fromDate: "2026-08-03",
    toDate: "2026-09-01",
  });
  assert.deepEqual(buildInclusiveDateWindow("2026-09-01", 60), {
    fromDate: "2026-07-04",
    toDate: "2026-09-01",
  });
  assert.deepEqual(buildInclusiveDateWindow("2026-09-01", 90), {
    fromDate: "2026-06-04",
    toDate: "2026-09-01",
  });
});

test("ALAIA GB 30d excludes August 2 from units and amount", () => {
  const window = buildInclusiveDateWindow("2026-09-01", 30);
  const rows = [
    { date: "2026-08-02", units: 2, amount: 248.34 },
    { date: "2026-08-03", units: 11, amount: 1365.87 },
  ];
  const included = rows.filter((row) => isDateInInclusiveWindow(row.date, window));
  assert.equal(included.reduce((sum, row) => sum + row.units, 0), 11);
  assert.equal(included.reduce((sum, row) => sum + row.amount, 0), 1365.87);
});

test("ALAIA GB 90d excludes June 3", () => {
  const window = buildInclusiveDateWindow("2026-09-01", 90);
  const rows = [
    { date: "2026-06-03", units: 5 },
    { date: "2026-06-04", units: 152 },
  ];
  const units = rows
    .filter((row) => isDateInInclusiveWindow(row.date, window))
    .reduce((sum, row) => sum + row.units, 0);
  assert.equal(units, 152);
});

test("inclusive windows are closed at both ends", () => {
  const window = buildInclusiveDateWindow("2026-09-01", 7);
  assert.equal(isDateInInclusiveWindow("2026-08-25", window), false);
  assert.equal(isDateInInclusiveWindow("2026-08-26", window), true);
  assert.equal(isDateInInclusiveWindow("2026-09-01", window), true);
  assert.equal(isDateInInclusiveWindow("2026-09-02", window), false);
});

test("Inventory sales readers share the inclusive period and close the query at periodTo", () => {
  const repository = fs.readFileSync(
    new URL("../repositories/inventoryRepository.ts", import.meta.url),
    "utf8",
  );
  const context = fs.readFileSync(
    new URL("./loadInventoryContext.ts", import.meta.url),
    "utf8",
  );

  assert.match(repository, /buildInclusiveDateWindow\(periodTo, 90\)\.fromDate/);
  assert.match(repository, /buildInclusiveDateWindow\(periodTo, 60\)\.fromDate/);
  assert.match(repository, /buildInclusiveDateWindow\(periodTo, 30\)\.fromDate/);
  assert.match(repository, /buildInclusiveDateWindow\(toDate, safe30\)\.fromDate/);
  assert.match(repository, /buildInclusiveDateWindow\(toDate, safe90\)\.fromDate/);
  assert.match(repository, /\.gte\("sale_date", queryFrom\)[\s\S]*?\.lte\("sale_date", toDate\)/);
  assert.match(repository, /isDateInInclusiveWindow\(row\.sale_date, window30\)/);
  assert.match(repository, /isDateInInclusiveWindow\(row\.sale_date, window90\)/);
  assert.match(context, /periodRange:\s*\{\s*fromDate: periodFrom,\s*toDate: periodTo/);
});
