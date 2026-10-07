// The charge and tax rules live in backend/regulatory/*.json (the one place a rate is written).
// The browser bundles a byte-for-byte mirror so order tickets can price a fill synchronously.
// Run `npm run sync:regulatory` after editing the backend files; a test fails if they drift.
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, "..", "backend", "regulatory");
if (!existsSync(source)) {
  console.error(`No backend/regulatory next to the frontend (looked in ${source}). Nothing copied.`);
  process.exit(1);
}
for (const file of ["charges.json", "tax_rules.json", "tax_vectors.json"]) {
  copyFileSync(path.join(source, file), path.join(root, "lib", "regulatory", file));
  console.log(`mirrored ${file}`);
}
