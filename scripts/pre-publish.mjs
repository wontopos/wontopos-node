// Runs from `prepublishOnly`.
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
