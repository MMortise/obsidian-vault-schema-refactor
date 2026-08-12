import { performance } from "node:perf_hooks";
import { parseDocument } from "yaml";

const markdownCount = Number(process.argv[2] ?? 10000);
const baseCount = Number(process.argv[3] ?? 200);
const targetFrontmatterMb = Number(process.argv[4] ?? 50);
const paddingLength = Math.max(0, Math.floor(targetFrontmatterMb * 1024 * 1024 / markdownCount) - 90);
const padding = "x".repeat(paddingLength);
const markdown = Array.from({ length: markdownCount }, (_, index) => `---\nstatus: ${index % 3 === 0 ? "active" : "archived"}\npriority: ${index % 5}\ntags: [project, fixture]\nfixture-padding: ${padding}\n---\n`);
const bases = Array.from({ length: baseCount }, (_, index) => `filters:\n  and:\n    - note.status == "active"\n    - note.priority >= ${index % 5}\nviews:\n  - type: table\n    order: [file.name, note.status, note.priority]\n`);

const start = performance.now();
for (const text of markdown) parseDocument(text.slice(4, text.lastIndexOf("---")));
for (const text of bases) parseDocument(text);
const elapsed = performance.now() - start;
const bytes = [...markdown, ...bases].reduce((sum, value) => sum + Buffer.byteLength(value), 0);
process.stdout.write(JSON.stringify({ markdownCount, baseCount, targetFrontmatterMb, bytes, elapsedMs: Math.round(elapsed), heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }, null, 2) + "\n");
