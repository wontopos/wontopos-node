// `require("wontopos")` did not work — and not in a degraded way. "type": "module"
// with no `require` condition in `exports` means Node's CJS resolver cannot resolve
// this package at all, so a LangChain integration or an in-house codebase that has
// not moved to ESM simply cannot install it. This file is written in CJS on purpose:
// an ESM test importing the CJS build would prove nothing about the resolver.
//
// `require("wontopos")` from inside the package is a self-reference — Node resolves
// it through this package's own `exports` map, which is exactly the map a consumer
// hits. Requiring dist/cjs/wontopos.js by path would test the file and skip the map.
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
  // Node reads the NEAREST package.json to decide a .js file's module kind, and the
  // root one says "module". Without this marker every file here would be parsed as
  // ESM and `require` would fail on the first `exports.` it met.
  const marker = JSON.parse(
    readFileSync(require.resolve("../dist/cjs/package.json"), "utf8"),
  );
  assert.equal(marker.type, "commonjs");
});

test("both builds carry the same public surface", () => {
  // Two emits of one source drift the moment one of them is regenerated alone.
  const cjs = Object.keys(require("wontopos")).sort();
  return import("../dist/wontopos.js").then((esm) => {
    const names = Object.keys(esm).sort();
    assert.deepEqual(cjs, names, "the two builds export different names");
  });
});
