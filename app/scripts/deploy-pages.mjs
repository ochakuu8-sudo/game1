// Builds the game and copies dist/'s contents into the repo root, since
// GitHub Pages here is configured to publish straight from main's root.
// Only entries that dist/ actually produces (index.html, assets/,
// favicon.svg, ...) are touched - everything else at repo root (README,
// app/, .git, .github) is left alone.
import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(appDir);
const distDir = path.join(appDir, "dist");

execSync("npm run build", { cwd: appDir, stdio: "inherit" });

if (!existsSync(distDir)) {
  console.error("dist/ not found after build.");
  process.exit(1);
}

for (const entry of readdirSync(distDir)) {
  const dest = path.join(repoRoot, entry);
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(distDir, entry), dest, { recursive: true });
}

console.log("\nCopied dist/ contents into repo root for GitHub Pages.");
