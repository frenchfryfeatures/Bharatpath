import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports: {}}; vm.runInNewContext(compiled, context); return context.exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
for (const [name, path] of [["web", "../features/student/profile/taxonomy-state.ts"], ["mobile", "../../mobile-app/services/api/taxonomyState.ts"]]) {
  const api = load(path);
  const selected = {industry_id: "i", industry: "Industry", department_id: "d", department: "Department", role_category_id: "c", role_category: "Category", job_role_id: "r", job_role: "Role", current_city: "Pune"};
  test(`${name}: changing an industry resets all descendants atomically`, () => {
    const next = api.chooseTaxonomy({...selected, taxonomy_others: {job_role: "Other role"}}, "industry", {id: "new", name: "New industry"});
    assert.equal(next.industry_id, "new"); assert.equal(next.industry, "New industry");
    for (const key of ["department", "role_category", "job_role"]) {assert.equal(next[key], ""); assert.equal(next[key + "_id"], null);}
    assert.deepEqual(plain(next.taxonomy_others), {}); assert.equal(next.current_city, "Pune");
    assert.equal(selected.industry_id, "i");
  });
  test(`${name}: changing department preserves industry and resets only lower fields`, () => {
    const next = api.chooseTaxonomy(selected, "department", {id: "d2", name: "Second"});
    assert.equal(next.industry_id, "i"); assert.equal(next.department_id, "d2"); assert.equal(next.role_category_id, null); assert.equal(next.job_role_id, null);
  });
  test(`${name}: parent gating and Others free-text descendants`, () => {
    assert.equal(api.taxonomyState({}, "department").disabled, true);
    const next = api.chooseTaxonomy({}, "industry", "other");
    assert.equal(api.taxonomyState(next, "department").freeText, true);
    assert.equal(api.taxonomyState(next, "job_role").disabled, false);
    assert.ok(api.taxonomyErrors(next).industry);
    const answer = api.writeTaxonomyText(next, "industry", "  A new industry  ");
    assert.deepEqual(plain(api.taxonomyErrors(answer)), {});
    assert.equal(answer.industry_id, null);
  });
  test(`${name}: custom input is bounded and strips markup/control characters`, () => {
    const next = api.writeTaxonomyText(selected, "department", "<Custom>\u0000" + "a".repeat(200));
    assert.equal(next.department.length, 160); assert.ok(!/[<>\u0000]/.test(next.department));
    assert.equal(next.taxonomy_others.department, next.department);
  });
}
