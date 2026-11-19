import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(elements) {
  let frame;
  const compiled = ts.transpileModule(fs.readFileSync(new URL("../lib/ui/focus-form-error.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const root = { querySelectorAll: () => elements };
  const context = { exports: {}, document: root, requestAnimationFrame: (callback) => { frame = callback; } };
  vm.runInNewContext(compiled, context);
  return { reveal: context.exports.focusFormError, flush: () => frame(), root };
}

function field(id, { hidden = false, disabled = false, control = null } = {}) {
  const calls = [];
  return {
    id, calls,
    getClientRects: () => hidden ? [] : [{}],
    hasAttribute: () => disabled,
    matches: () => !control,
    querySelector: () => control,
    scrollIntoView: () => calls.push("scroll"),
    focus: (options) => { assert.equal(options.preventScroll, true); calls.push("focus"); },
  };
}

test("waits for error rendering, then chooses the first error in screen order", () => {
  const name = field("name"), salary = field("salary");
  const f = fixture([name, salary]);
  f.reveal(f.root, ["salary", "name"]);
  assert.deepEqual(name.calls, []);
  f.flush();
  assert.deepEqual(name.calls, ["scroll", "focus"]);
  assert.deepEqual(salary.calls, []);
});

test("skips hidden step fields and disabled inputs", () => {
  const hidden = field("hidden", { hidden: true });
  const disabled = field("disabled", { disabled: true });
  const visible = field("visible");
  const f = fixture([hidden, disabled, visible]);
  f.reveal(); f.flush();
  assert.deepEqual(visible.calls, ["scroll", "focus"]);
  assert.deepEqual(hidden.calls, []);
  assert.deepEqual(disabled.calls, []);
});

test("custom field wrappers scroll their error into view and focus the nested control", () => {
  const input = field("phone-input");
  const wrapper = field("phone", { control: input });
  const f = fixture([wrapper]);
  f.reveal(); f.flush();
  assert.deepEqual(wrapper.calls, ["scroll"]);
  assert.deepEqual(input.calls, ["focus"]);
});

test("a form without errors does not move focus", () => {
  const f = fixture([]);
  f.reveal(); assert.doesNotThrow(f.flush);
});
