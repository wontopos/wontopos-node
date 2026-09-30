// CommonJS on purpose: `require("wontopos")` here is a self-reference that Node resolves
// through this package's `exports` map, the same map a consumer hits.
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

// The types half. Under "type": "module", dist/wontopos.d.ts is an ESM declaration, so a
// TypeScript CJS consumer on node16/nodenext resolution needs the require condition to
// name its own .d.cts (TS1479 otherwise).
test("the require condition ships a CommonJS declaration file", () => {
  // Through the exports map, which is also what a bundler does — a map that omits
  // "./package.json" makes this ERR_PACKAGE_PATH_NOT_EXPORTED.
  const pkg = JSON.parse(readFileSync(require.resolve("wontopos/package.json"), "utf8"));
  const req = pkg.exports["."].require;
  assert.equal(typeof req, "object", "the require condition must carry its own types");
  assert.ok(req.types.endsWith(".d.cts"), `require types must be .d.cts, got ${req.types}`);
  assert.ok(pkg.exports["."].import.types.endsWith(".d.ts"), "import types stay .d.ts");
  for (const rel of [req.types, req.default, pkg.exports["."].import.types, pkg.exports["."].import.default]) {
    assert.ok(readFileSync(require("node:path").join(__dirname, "..", rel), "utf8").length > 0, `${rel} must exist`);
  }
});
