#!/usr/bin/env bash
#
# Bump the semver version in package.json and prepend a new CHANGELOG entry.
#
# Usage:
#   ./scripts/bump-version.sh patch   # 0.4.0 -> 0.4.1
#   ./scripts/bump-version.sh minor   # 0.4.0 -> 0.5.0
#   ./scripts/bump-version.sh major   # 0.4.0 -> 1.0.0

set -euo pipefail

LEVEL="${1:-}"

if [[ -z "$LEVEL" ]] || [[ ! "$LEVEL" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 <patch|minor|major>"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/package.json"
CHANGELOG="$ROOT/CHANGELOG.md"

CURRENT=$(node -p "require('$PKG').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$LEVEL" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
TODAY=$(date +%Y-%m-%d)

# Update package.json (portable sed: works on macOS and Linux)
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$PKG"
else
  sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$PKG"
fi

# Prepend new changelog section after the header lines
ENTRY="## [$NEW_VERSION] - $TODAY

### Added

### Changed

### Fixed
"

if [[ -f "$CHANGELOG" ]]; then
  # Insert the new entry before the first existing ## entry
  awk -v entry="$ENTRY" '
    /^## \[/ && !inserted {
      print entry
      inserted=1
    }
    { print }
  ' "$CHANGELOG" > "$CHANGELOG.tmp" && mv "$CHANGELOG.tmp" "$CHANGELOG"
else
  cat > "$CHANGELOG" <<EOF
# Changelog

All notable changes to Databricks Forge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

$ENTRY
EOF
fi

echo "Bumped version: $CURRENT -> $NEW_VERSION"
echo "Updated: $PKG"
echo "Updated: $CHANGELOG"
echo ""
echo "Next steps:"
echo "  1. Fill in the CHANGELOG entry for [$NEW_VERSION]"
echo "  2. git add package.json CHANGELOG.md && git commit -m 'release: v$NEW_VERSION'"
