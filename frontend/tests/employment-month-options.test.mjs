import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(path) {
 const source=fs.readFileSync(new URL(path,import.meta.url),"utf8");
 const context={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context.exports.monthYearOptions;
}
for(const [platform,path] of [["web","../lib/ui/month-year-options.ts"],["mobile","../../mobile-app/utils/monthYearOptions.ts"]]) {
 const options=load(path); const now=new Date(2026,10,17);
 test(`${platform}: February 2025 permits March through December in the same year`,()=>{
  const result=options("2025","2025-02",now);
  assert.deepEqual(Array.from(result.months),["03","04","05","06","07","08","09","10","11","12"]);
  assert.ok(result.years.includes("2025")); assert.ok(!result.years.includes("2024"));
 });
 test(`${platform}: the same month is valid in a later year`,()=>{
  assert.ok(options("2026","2025-02",now).months.includes("02"));
  assert.equal(options("2024","2025-02",now).months.length,0);
 });
 test(`${platform}: December rolls the first ending year to the next year`,()=>{
  const result=options("2026","2025-12",now);
  assert.ok(!result.years.includes("2025"));assert.ok(result.months.includes("01"));
 });
 test(`${platform}: future employment months remain excluded`,()=>{
  assert.ok(!options("2026","2025-02",now).months.includes("12"));
  assert.equal(options("2026","2026-11",now).years.length,0);
 });
 test(`${platform}: month-first selection still offers a later matching year`,()=>{
  assert.ok(options("","2025-02",now).months.includes("02"));
  assert.ok(!options("","2026-02",now).months.includes("02"));
 });
}
