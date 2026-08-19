# Changelog

## [1.0.0](https://github.com/camcima/nestjs-deprecation/compare/v0.2.0...v1.0.0) (2026-08-19)

### Bug Fixes

* resolve second-round architecture review findings ([#4](https://github.com/camcima/nestjs-deprecation/issues/4)) ([318f672](https://github.com/camcima/nestjs-deprecation/commit/318f672f0e0bd4f584b68f4dd85c9eb0ee5bbadb))

## [0.2.0](https://github.com/camcima/nestjs-deprecation/compare/v0.1.0...v0.2.0) (2026-07-10)

### ⚠ BREAKING CHANGES

* applyDeprecationDocs now takes (document, app, options?)
and returns the document; call it on the result of createDocument().

### Features

* make applyDeprecationDocs a pure per-document transform ([88b8daa](https://github.com/camcima/nestjs-deprecation/commit/88b8daaaf5f729e178c6d2c0c981171765a090fe))

### Bug Fixes

* contain rejected async onDeprecatedCall listeners and widen the listener type ([4f8f910](https://github.com/camcima/nestjs-deprecation/commit/4f8f91012ed90f5f29430cf1530337872f9d2854))
* drop raw-URL telemetry route fallback in favor of "unknown" ([848e9f1](https://github.com/camcima/nestjs-deprecation/commit/848e9f17fe449ad71dd0e7dd97b8584dc2cdd8cd))
* make duplicate DeprecationModule registration idempotent ([7426611](https://github.com/camcima/nestjs-deprecation/commit/74266116fe81269e582cc550e517590375358190))
* reject array module options and non-object links entries at boot ([582eb7c](https://github.com/camcima/nestjs-deprecation/commit/582eb7cd98393db3105cd1e31986c0c88755f940))
* reject Link-grammar-breaking characters and non-string options at decoration time ([5224a94](https://github.com/camcima/nestjs-deprecation/commit/5224a9430e558ba35f2003a2e57ce078d5ad741d))
* truncate deprecation dates to whole seconds so all representations agree ([1d136a4](https://github.com/camcima/nestjs-deprecation/commit/1d136a465119cfa8d255a28437c91346263ed80b))
* validate module options at boot instead of failing open per request ([f022bfc](https://github.com/camcima/nestjs-deprecation/commit/f022bfc8ce58b56970e2a73103c05363605fbec0))

## 0.1.0 (2026-07-09)
