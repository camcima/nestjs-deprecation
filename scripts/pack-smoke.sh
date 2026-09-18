#!/usr/bin/env bash
# Packs the library, installs the tarball into a throwaway consumer project
# beside a real NestJS release, and boots an app from it twice: once through
# require() and once through import. Catches packaging regressions (exports
# map, files list, missing dist output), peer ranges that do not admit the
# Nest major (npm refuses the install with ERESOLVE, as it would for a user),
# and CommonJS/ESM interop: this package is CommonJS while Nest 12 is
# ESM-only, a path the src-importing Vitest suite never exercises.
#
# NEST_MAJOR selects the Nest line to install (default: 12, the dev baseline).
set -euo pipefail

nest_major=${NEST_MAJOR:-12}
case "$nest_major" in
  10) swagger_range='^8.0.0' ;;
  11) swagger_range='^11.0.0' ;;
  12) swagger_range='^12.0.0' ;;
  *)
    echo "pack-smoke: unsupported NEST_MAJOR=$nest_major (expected 10, 11 or 12)" >&2
    exit 1
    ;;
esac

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

cd "$repo_dir"
pnpm run build
pnpm pack --pack-destination "$work_dir"

cd "$work_dir"
npm init -y > /dev/null
# Deliberately no --legacy-peer-deps: the peer ranges are part of what is tested.
npm install --no-save --no-audit --no-fund \
  ./camcima-nestjs-deprecation-*.tgz \
  "@nestjs/common@^$nest_major" "@nestjs/core@^$nest_major" \
  "@nestjs/platform-express@^$nest_major" "@nestjs/swagger@$swagger_range" \
  @opentelemetry/api@^1.9 reflect-metadata@^0.2 rxjs@^7 > /dev/null

cp "$repo_dir"/scripts/pack-smoke/* .
node consumer.cjs
node consumer.mjs
