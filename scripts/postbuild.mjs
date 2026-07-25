#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync } from "node:fs";

const STANDALONE = ".next/standalone";

if (!existsSync(STANDALONE)) {
  console.error(`[postbuild] ERROR: ${STANDALONE} not found — did next build succeed?`);
  process.exit(1);
}

console.log("[postbuild] Copying public/ assets...");
cpSync("public", `${STANDALONE}/public`, { recursive: true });

console.log("[postbuild] Copying .next/static/ assets...");
mkdirSync(`${STANDALONE}/.next`, { recursive: true });
cpSync(".next/static", `${STANDALONE}/.next/static`, { recursive: true });

console.log("[postbuild] Standalone bundle ready.");
