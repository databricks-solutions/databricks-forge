#!/bin/sh
# Databricks Forge — Zero-egress bootstrap
#
# This script is the entry point for --zero-egress deployments.
# It reassembles the split archive, extracts the full app bundle,
# cleans up the archive parts, then delegates to the normal start.sh.

set -e

echo "[bootstrap] Zero-egress deployment detected."
echo "[bootstrap] Reassembling archive..."
cat bundle.tar.gz.part-* > bundle.tar.gz

BUNDLE_SIZE=$(du -h bundle.tar.gz | cut -f1)
echo "[bootstrap] Extracting bundle ($BUNDLE_SIZE)..."
tar xzf bundle.tar.gz

echo "[bootstrap] Cleaning up archive parts..."
rm -f bundle.tar.gz bundle.tar.gz.part-*

echo "[bootstrap] Handing off to start.sh..."
exec sh scripts/start.sh
