import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/ui/floating-position.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { floatingPosition } = context.exports;
const viewport = { left: 0, top: 0, width: 1024, height: 768 };
const anchor = { left: 600, right: 900, top: 600, bottom: 640, width: 300 };

test("a bottom-edge dropdown opens upward without going behind the footer", () => {
  const result = floatingPosition(anchor, 200, viewport, { maxHeight: 280 });
  assert.equal(result.top + 200, anchor.top - 6);
  assert.equal(result.left, anchor.left);
});

test("a right-aligned filter panel stays inside a narrow screen", () => {
  const result = floatingPosition(anchor, 600, { ...viewport, width: 320 }, { width: 600, align: "right" });
  assert.equal(result.width, 296);
  assert.equal(result.left, 12);
});

test("tall panels are height-limited and scroll inside the visible screen", () => {
  const result = floatingPosition(anchor, 1200, viewport, { width: 600 });
  assert.ok(result.maxHeight < 1200);
  assert.ok(result.top + result.maxHeight <= viewport.height - 12);
});

test("menus follow visual viewport offsets used by zoom and mobile keyboards", () => {
  const result = floatingPosition(anchor, 500, { left: 100, top: 80, width: 375, height: 240 }, { width: 600 });
  assert.ok(result.left >= 112);
  assert.ok(result.left + result.width <= 463);
  assert.ok(result.top >= 92);
  assert.ok(result.top + Math.min(500, result.maxHeight) <= 308);
});

test("overlay bounds hold across mobile, tablet, desktop, short and zoomed viewports", () => {
  for (const width of [160, 240, 320, 375, 768, 1280, 1920]) {
    for (const height of [120, 240, 480, 720, 1080]) {
      for (const left of [-100, 0, width / 2, width - 50, width + 100]) {
        for (const top of [-100, 0, height / 2, height - 40, height + 100]) {
          for (const panelHeight of [80, 280, 900]) {
            const result = floatingPosition({ left, right: left + 180, top, bottom: top + 44, width: 180 }, panelHeight,
              { left: 0, top: 0, width, height }, { width: 600 });
            const margin = Math.min(12, width / 4, height / 4);
            assert.ok(Object.values(result).every(Number.isFinite));
            assert.ok(result.left >= margin);
            assert.ok(result.top >= margin);
            assert.ok(result.width >= 0 && result.maxHeight >= 0);
            assert.ok(result.left + result.width <= width - margin + 0.001);
            assert.ok(result.top + Math.min(panelHeight, result.maxHeight) <= height - margin + 0.001);
          }
        }
      }
    }
  }
});
