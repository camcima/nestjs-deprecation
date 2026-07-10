#!/usr/bin/env bash
# Packs the library and loads every public entry point from the installed
# tarball in a throwaway consumer project — catches packaging regressions
# (exports map, files list, missing dist output) that src-importing tests miss.
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

cd "$repo_dir"
pnpm run build
pnpm pack --pack-destination "$work_dir"

cd "$work_dir"
npm init -y > /dev/null
npm install --no-save --no-audit --no-fund \
  ./camcima-nestjs-deprecation-*.tgz \
  @nestjs/common@^11 @nestjs/core@^11 @opentelemetry/api@^1.9 \
  reflect-metadata@^0.2 rxjs@^7 > /dev/null

node -e "
require('reflect-metadata');
const root = require('@camcima/nestjs-deprecation');
const swagger = require('@camcima/nestjs-deprecation/swagger');
const otel = require('@camcima/nestjs-deprecation/otel');
if (typeof root.Deprecated !== 'function') throw new Error('root: Deprecated export missing');
if (typeof root.DeprecationModule.forRoot !== 'function') throw new Error('root: DeprecationModule export missing');
if (typeof swagger.applyDeprecationDocs !== 'function') throw new Error('swagger: applyDeprecationDocs export missing');
if (typeof otel.createOtelDeprecationListener !== 'function') throw new Error('otel: createOtelDeprecationListener export missing');
console.log('pack smoke OK');
"
