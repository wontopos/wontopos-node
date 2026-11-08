import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function npm(args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(NPM, args, { cwd, encoding: "utf8", env, shell: process.platform === "win32" });
  assert.equal(r.status, 0, `npm ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

test("a build leaves nothing in dist from an earlier build, so a removed module never ships", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wontopos-pack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const f of ["package.json", "tsconfig.json", "tsconfig.cjs.json", "tsconfig.types.json", "README.md", "LICENSE"]) {
    cpSync(join(PKG, f), join(dir, f));
  }
  cpSync(join(PKG, "src"), join(dir, "src"), { recursive: true });
  symlinkSync(join(PKG, "node_modules"), join(dir, "node_modules"), "junction");
  mkdirSync(join(dir, "dist", "cjs"), { recursive: true });
  writeFileSync(join(dir, "dist", "removed.js"), "export {};\n");
  writeFileSync(join(dir, "dist", "removed.d.ts"), "export {};\n");
  writeFileSync(join(dir, "dist", "cjs", "removed.js"), "module.exports = {};\n");
  npm(["run", "build", "--silent"], dir);
  const files = JSON.parse(npm(["pack", "--dry-run", "--json", "--ignore-scripts"], dir))[0].files.map((f) => f.path);
  for (const shipped of ["dist/wontopos.js", "dist/wontopos.d.ts", "dist/cjs/wontopos.js", "dist/cjs/wontopos.d.cts", "dist/cjs/package.json"]) {
    assert.ok(files.includes(shipped), `${shipped} is missing from the tarball`);
  }
  assert.deepEqual(files.filter((f) => f.includes("removed")), []);
});
