// Zips dist/ into a single itch.io-uploadable archive. Run via `npm run zip`
// (builds first, then zips). itch's web export expects the zip's *contents*
// to be index.html + assets at the top level, which is why we zip the
// contents of dist/ rather than the dist/ folder itself.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, "dist");
const outDir = path.join(root, "release");
const outFile = path.join(outDir, "kaiju-pinball-web.zip");

if (!existsSync(distDir)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

execFileSync("zip", ["-r", outFile, "."], { cwd: distDir, stdio: "inherit" });

console.log(`\nCreated ${path.relative(root, outFile)} — upload this directly as an HTML5 project on itch.io.`);
