// Runs from `prepublishOnly`, and exists so the package manifest does not name it.
//
// The gate invocation used to sit inline in package.json. npm publishes package.json
// in full, `scripts` included, so the registry page for this package would have shown
// the sibling checkout's directory name and the scanner's filename — which is an
// advertisement that a leak screen exists over a closed surface, and a hint at what it
// screens for. This file is not in `files`, so it stays here.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const gate = process.env.WONTOPOS_GATE ?? resolve(pkg, "..", "..", "sdk-gate");
const scanner = join(gate, "leak-gate.mjs");

if (!existsSync(scanner)) {
  console.error(
    "pre-publish: the checks are not on this machine. Set WONTOPOS_GATE to the " +
      "directory that holds them. Publishing without them is not a shortcut."
  );
  process.exit(1);
}
execFileSync(process.execPath, [scanner, "--root", resolve(pkg, ".."), "--package", "typescript"], {
  stdio: "inherit",
});
