import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../dist/wontopos.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, "parity-refusals.json"));
const { cases } = JSON.parse(RAW.toString("utf8"));
const PY_COPY = join(HERE, "..", "..", "python", "tests", "parity_refusals.json");

test("each refusal says what the fixture says, before anything is sent", async () => {
  const mem = new Client({ apiKey: "wos-test-xxxxxxxxxxxxxxxx", baseUrl: "http://127.0.0.1:9", maxRetries: 0, timeoutMs: 2000 });
  assert.ok(cases.length >= 40);
  for (const c of cases) {
    const run = new Function("mem", `return (async () => { await ${c.typescript}; })()`);
    await assert.rejects(run(mem), (e) => {
      assert.equal(e.message, c.typescript_says, c.case);
      return true;
    }, c.case);
  }
});

test("Python reads the same bytes when it is here", { skip: !existsSync(PY_COPY) && "the Python tests are not here" }, () => {
  assert.deepEqual(readFileSync(PY_COPY), RAW);
});
