import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const vaultPath = process.argv[2];
if (!vaultPath) {
  process.stderr.write("Usage: npm run install:dev -- /absolute/path/to/test-vault\n");
  process.exitCode = 1;
} else {
  const target = resolve(vaultPath, ".obsidian", "plugins", "schema-refactor");
  await mkdir(target, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) await cp(resolve(file), resolve(target, file));
  process.stdout.write(`Installed Schema Refactor in ${target}\n`);
}
