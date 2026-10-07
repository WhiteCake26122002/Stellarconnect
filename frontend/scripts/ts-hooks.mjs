// Resolves the project's extension-less and "@/" imports for `node --test`, so the pure TypeScript
// in lib/ can be tested without a bundler. Node 24 strips the types itself.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  if (target && !path.extname(target)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(target + ext)) return next(pathToFileURL(target + ext).href, context);
    }
  }
  return next(specifier, context);
}
