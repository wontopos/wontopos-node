const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("require('wontopos') resolves through the exports map", () => {
  const mod = require("wontopos");
  assert.equal(typeof mod.Client, "function", "Client is missing from the CJS build");
  assert.equal(typeof mod.WosError, "function");
  assert.equal(typeof mod.APIConnectionError, "function");
  assert.ok(mod.default, "default export missing");
  assert.equal(mod.WME, mod.Client, "the back-compat alias must survive both builds");
});

test("the CJS build declares itself CommonJS", () => {
  const marker = JSON.parse(
    readFileSync(require.resolve("../dist/cjs/package.json"), "utf8"),
  );
  assert.equal(marker.type, "commonjs");
});

test("both builds carry the same public surface", () => {
  const cjs = Object.keys(require("wontopos")).sort();
  return import("../dist/wontopos.js").then((esm) => {
    const names = Object.keys(esm).sort();
    assert.deepEqual(cjs, names, "the two builds export different names");
  });
});

test("the require condition ships a CommonJS declaration file", () => {
  const pkg = JSON.parse(readFileSync(require.resolve("wontopos/package.json"), "utf8"));
  const req = pkg.exports["."].require;
  assert.equal(typeof req, "object", "the require condition must carry its own types");
  assert.ok(req.types.endsWith(".d.cts"), `require types must be .d.cts, got ${req.types}`);
  assert.ok(pkg.exports["."].import.types.endsWith(".d.ts"), "import types stay .d.ts");
  for (const rel of [req.types, req.default, pkg.exports["."].import.types, pkg.exports["."].import.default]) {
    assert.ok(readFileSync(require("node:path").join(__dirname, "..", rel), "utf8").length > 0, `${rel} must exist`);
  }
});

test("the sleep loads under require, and its declarations sit beside the CJS types", () => {
  const mod = require("wontopos");
  assert.equal(mod.SLEEP_VERSION, "1.0.2");
  assert.equal(new mod.SleepSettings({ readers: 2 }).readers, 2);
  assert.equal(typeof mod.Client.prototype.sleep, "function");
  const dir = require("node:path").join(__dirname, "..", "dist", "cjs");
  assert.match(readFileSync(require("node:path").join(dir, "wontopos.d.cts"), "utf8"), /from "\.\/sleep\.js"/);
  assert.match(readFileSync(require("node:path").join(dir, "sleep.d.ts"), "utf8"), /export declare class SleepSettings/);
});
