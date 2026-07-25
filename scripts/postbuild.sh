#!/bin/sh
# Copies assets that Next.js standalone expects adjacent to server.js.
# The standalone output has server.js + minimal node_modules but does NOT
# include public/ or .next/static/.  This runs after `next build`.

set -e

STANDALONE=".next/standalone"

if [ ! -d "$STANDALONE" ]; then
  echo "[postbuild] ERROR: $STANDALONE not found — did next build succeed?"
  exit 1
fi

echo "[postbuild] Copying public/ assets..."
cp -r public "$STANDALONE/public"

echo "[postbuild] Copying .next/static/ assets..."
mkdir -p "$STANDALONE/.next"
cp -r .next/static "$STANDALONE/.next/static"

echo "[postbuild] Standalone bundle ready."
