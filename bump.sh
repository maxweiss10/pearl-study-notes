#!/bin/bash
# Pearl — bump build version in index.html so clients bust cache.
# Usage: ./bump.sh [optional commit message]

set -e
cd "$(dirname "$0")"

VERSION=$(date +%Y%m%d-%H%M%S)

# Replace PEARL_BUILD="…" line in index.html (or insert if missing)
if grep -q 'PEARL_BUILD="' index.html; then
  sed -i '' -E "s/PEARL_BUILD=\"[^\"]*\"/PEARL_BUILD=\"$VERSION\"/" index.html
else
  echo "Error: PEARL_BUILD marker missing from index.html" >&2
  exit 1
fi

echo "Bumped build version → $VERSION"

if ! git diff --quiet index.html; then
  git add index.html
  git commit -q -m "${1:-Bump build $VERSION}"
  echo "Committed."

  if [ "$1" != "--no-push" ]; then
    git push -q origin main && echo "Pushed."
  fi
fi
