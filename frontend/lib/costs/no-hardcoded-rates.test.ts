// A rate written into a component or a helper is a second source of truth. This scans the UI and the
// libraries for the literals the configuration owns, so a rate change stays a change to the JSON.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Only literals that are unmistakably tax or charge rates: bare numbers such as 12.5 or 0.015 also appear as chart geometry or UI tolerances.
const FORBIDDEN = /(?<![\w.])(0\.125|125000|1,25,000|1\.25 lakh|12\.5%|0\.00297|0\.00307|0\.00375|0\.03553|0\.0325)(?![\w])/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next" || name === "regulatory") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("rates live in the configuration only", () => {
  const files = [...walk(path.join(root, "components")), ...walk(path.join(root, "lib")), ...walk(path.join(root, "app"))];
  it("scans a meaningful set of files", () => assert.ok(files.length > 40));
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    it(`${rel} holds no rate literal`, () => {
      const hits = [...strip(readFileSync(file, "utf8")).matchAll(FORBIDDEN)].map((m) => m[0]);
      assert.deepEqual(hits, [], `${rel} writes a rate that belongs in lib/regulatory: ${hits.join(", ")}`);
    });
  }
});
