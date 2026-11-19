import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: (name) => imports[name] ?? {}, console, Intl };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const web = load("../features/student/profile/career-api.ts", {
  "@/store/api/base-api": { baseApi: { injectEndpoints: () => ({}) } },
});
const mobile = load("../../mobile-app/services/api/career.ts");
const salary = load("../features/student/salary.ts");
const mobileSalary = load("../../mobile-app/screens/onboarding/conversationValidation.ts");

for (const [client, api, visible, required] of [
  ["web", web, "visibleCareerField", "careerFieldRequired"],
  ["mobile", mobile, "fieldVisible", "fieldRequired"],
]) {
  test(`${client} preserves previous employment, currency and immediate joining`, () => {
    const details = { work_status: "EXPERIENCED", currently_employed: "NO", company_name: "Previous company",
      job_title: "Engineer", employment_end: "2024-01", annual_salary: 75000, annual_salary_currency: "USD" };
    const saved = api.careerDetailsForSave(details);
    assert.equal(saved.company_name, details.company_name);
    assert.equal(saved.annual_salary_currency, "USD");
    assert.equal(saved.annual_salary, 75000);
    assert.equal(saved.notice_period, "IMMEDIATE");
    assert.equal(api[visible]({ key: "employment_end" }, details), true);
    assert.equal(api[required]({ key: "employment_end" }, details), true);
    assert.equal(api[visible]({ key: "notice_period" }, details), false);
    assert.equal(api[required]({ key: "notice_period" }, { ...details, currently_employed: "YES" }), true);
  });
}

test("salary amounts have the same explicit units in both clients", () => {
  for (const parse of [salary.parseSalaryLpa, mobileSalary.parseSalaryInput]) {
    assert.equal(parse("75", "INR").value, 75);
    assert.equal(parse("75000", "USD").value, 75000);
    assert.ok(parse("$75000", "INR").error);
    assert.ok(parse("₹75000", "USD").error);
  }
  assert.ok(salary.formatSalaryLpaFromRupees(75000, "USD").startsWith("$"));
  assert.ok(mobileSalary.formatSalaryDisplay(75000, "USD").startsWith("$"));
});

test("current and previous labels follow the employment context", () => {
  assert.equal(salary.profileFieldLabel("company_name", ""), "Current Company");
  assert.equal(salary.profileFieldLabel("job_title", ""), "Current Job Title");
  assert.equal(salary.profileFieldLabel("annual_salary", ""), "Annual Salary");
  assert.equal(salary.profileFieldLabel("company_name", "", { work_status: "EXPERIENCED", currently_employed: "NO" }), "Previous Company");
});

const webValidation = load("../features/student/profile/conversation-validation.ts", {"../salary": salary});
for (const [name, api, fn] of [["web", web, "careerFieldRequired"], ["mobile", mobile, "fieldRequired"]]) {
  test(`${name}: salary required for current and previous employment, exempt for freshers`, () => {
    for (const employed of ["YES", "NO"]) assert.equal(api[fn]({key: "annual_salary"}, {work_status: "EXPERIENCED", currently_employed: employed}), true);
    assert.equal(api[fn]({key: "annual_salary"}, {work_status: "FRESHER", currently_employed: "NO"}), false);
  });
}
for (const [name, api] of [["web", webValidation], ["mobile", mobileSalary]]) {
  test(`${name}: employment ending month must be strictly later`, () => {
    const field = {key: "employment_end", type: "month", options: []};
    for (const value of ["2020-01", "2020-02"]) assert.ok(api.parseConversationAnswer(field, value, true, {employment_start: "2020-02"}).error);
    assert.equal(api.parseConversationAnswer(field, "2020-03", true, {employment_start: "2020-02"}).value, "2020-03");
    assert.ok(api.parseConversationAnswer({...field, key: "employment_start"}, "2020-03", true, {employment_end: "2020-02"}).error);
  });
}
