# @camcima/nestjs-deprecation

NestJS library for RFC 9745 (`Deprecation`) and RFC 8594 (`Sunset`) HTTP response headers — decorator-driven API deprecation with Swagger and OpenTelemetry integration.

## Table of Contents

- [What are RFC 9745 / RFC 8594?](#what-are-rfc-9745--rfc-8594)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Swagger integration](#swagger-integration)
- [Telemetry](#telemetry)
- [Strictly informational](#strictly-informational)
- [Known limitations](#known-limitations)
- [API Reference](#api-reference)
- [Prior art](#prior-art)
- [License](#license)

## What are RFC 9745 / RFC 8594?

[RFC 9745](https://www.rfc-editor.org/rfc/rfc9745) (published 2025) defines the `Deprecation` HTTP response header: a machine-readable signal that a resource has been, or will be, deprecated as of a given date. [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594) defines the companion `Sunset` header: the date after which the resource is expected to stop responding. Together with an RFC 8288 `Link` header pointing clients at deprecation docs and/or a successor endpoint, they give API consumers a standard way to detect and react to deprecations without out-of-band communication (changelogs, emails, Slack messages).

To our knowledge, `@camcima/nestjs-deprecation` is the first NestJS implementation of RFC 9745.

A deprecated endpoint's response looks like this:

```
HTTP/1.1 200 OK
Deprecation: @1782864000
Sunset: Fri, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.example.com/deprecations/orders-v1>; rel="deprecation", </v2/orders>; rel="successor-version"
```

- `Deprecation` carries an RFC 9651 structured-field date: `@` followed by a Unix timestamp in seconds.
- `Sunset` carries an HTTP-date (IMF-fixdate) and is only sent when a sunset date is configured.
- `Link` carries `rel="deprecation"` (RFC 9745, pointing at documentation) and `rel="successor-version"` (RFC 5829, pointing at the replacement), plus any other relations you add.

## Installation

```bash
npm install @camcima/nestjs-deprecation
```

```bash
pnpm add @camcima/nestjs-deprecation
```

### Peer dependencies

| Package              | Version                           | Required                                   |
| -------------------- | --------------------------------- | ------------------------------------------ |
| `@nestjs/common`     | `^10.0.0 \|\| ^11.0.0`            | Yes                                        |
| `@nestjs/core`       | `^10.0.0 \|\| ^11.0.0`            | Yes                                        |
| `reflect-metadata`   | `^0.1.13 \|\| ^0.2.0`             | Yes                                        |
| `@nestjs/swagger`    | `^7.0.0 \|\| ^8.0.0 \|\| ^11.0.0` | No (optional, for the `./swagger` subpath) |
| `@opentelemetry/api` | `>=1.8.0`                         | No (optional, for the `./otel` subpath)    |

## Quick Start

Register `DeprecationModule.forRoot()` once in your root `AppModule`. It registers a global `APP_INTERCEPTOR` that writes deprecation headers on any handler or controller decorated with `@Deprecated()`.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { DeprecationModule } from '@camcima/nestjs-deprecation';

@Module({
  imports: [DeprecationModule.forRoot()],
})
export class AppModule {}
```

Decorate a handler (or an entire controller class) with `@Deprecated()`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Deprecated } from '@camcima/nestjs-deprecation';

@Controller('orders')
export class OrdersController {
  @Deprecated({
    deprecatedAt: '2026-07-01T00:00:00Z',
    sunsetAt: '2027-01-01T00:00:00Z',
    link: 'https://docs.example.com/deprecations/orders-v1',
    successor: '/v2/orders',
    links: [{ rel: 'latest-version', href: '/v3/orders', type: 'application/json' }],
    note: 'Use POST /v2/orders',
  })
  @Get()
  list() {
    /* ... */
  }
}
```

That produces exactly the response headers shown above:

```
Deprecation: @1782864000
Sunset: Fri, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.example.com/deprecations/orders-v1>; rel="deprecation", </v2/orders>; rel="successor-version"
```

(The `links` escape hatch above adds a third, custom `rel="latest-version"` link into the same header; it is omitted from the example response for brevity. `note` is never sent on the wire — it only surfaces in Swagger docs and in the telemetry event.)

### `@Deprecated()` options

| Option         | Type             | Required | Description                                                                              |
| -------------- | ---------------- | -------- | ---------------------------------------------------------------------------------------- |
| `deprecatedAt` | `Date \| string` | Yes      | When the endpoint is (or will be) deprecated. May be in the future.                      |
| `sunsetAt`     | `Date \| string` | No       | When the endpoint stops working. Must not be earlier than `deprecatedAt`.                |
| `link`         | `string`         | No       | Deprecation documentation URL — emitted as `Link; rel="deprecation"` (RFC 9745).         |
| `successor`    | `string`         | No       | Replacement endpoint — emitted as `Link; rel="successor-version"` (RFC 5829).            |
| `links`        | `LinkRelation[]` | No       | Escape hatch for arbitrary RFC 8288 relations, appended after `link`/`successor`.        |
| `note`         | `string`         | No       | Human note; never sent on the wire. Surfaces in Swagger docs and in the telemetry event. |

Both dates accept a `Date` or an ISO 8601 string. Invalid options (unparseable dates, a `sunsetAt` before `deprecatedAt`, a malformed URL/path) throw **at decoration time** — i.e. when your application boots — rather than on the first matching request, so misconfiguration fails loudly and early. `@Deprecated()` can decorate a single handler method or an entire controller class; a method-level decorator overrides a class-level one on that method.

### Async configuration

```typescript
DeprecationModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get<boolean>('DEPRECATION_HEADERS_ENABLED', true),
  }),
});
```

`DeprecationModuleOptions` accepts:

| Option             | Type              | Default | Description                                                                                                                                                          |
| ------------------ | ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `boolean`         | `true`  | Kill switch. When `false`, the interceptor is a pure pass-through.                                                                                                   |
| `onDeprecatedCall` | `(event) => void` | —       | Invoked on every request to a deprecated endpoint. See [Telemetry](#telemetry). Errors thrown by the listener are caught and logged; they never affect the response. |

## Swagger integration

The `./swagger` subpath is optional and requires `@nestjs/swagger` (already a common dependency in NestJS apps). It discovers every `@Deprecated()`-decorated controller/handler via `DiscoveryService` and:

1. Sets `deprecated: true` on the OpenAPI operation.
2. Appends a generated Markdown block to the operation description (deprecation date, sunset date, `note`, links) — merged with, not clobbering, any `@ApiOperation()` you already applied.
3. Documents the `Deprecation` / `Sunset` / `Link` response headers with example values.

Add `DiscoveryModule` (from `@nestjs/core`) to your application module, and call `applyDeprecationDocs(app)` inside the lazy document factory passed to `SwaggerModule.setup()` — this ordering matters, since the decoration must run before the OpenAPI document is built:

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DeprecationModule } from '@camcima/nestjs-deprecation';

@Module({
  imports: [DiscoveryModule, DeprecationModule.forRoot()],
})
export class AppModule {}
```

```typescript
// main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyDeprecationDocs } from '@camcima/nestjs-deprecation/swagger';

const config = new DocumentBuilder().setTitle('My API').build();

SwaggerModule.setup('/api', app, () => {
  applyDeprecationDocs(app);
  return SwaggerModule.createDocument(app, config);
});
```

`applyDeprecationDocs(app, options?)` accepts an optional `filter` callback to skip specific controllers:

```typescript
applyDeprecationDocs(app, {
  filter: (controller) => controller.name !== 'HealthController',
});
```

If `DiscoveryModule` is not imported, `applyDeprecationDocs` throws a clear setup error naming the fix, rather than failing silently.

`applyDeprecationDocs` is independent of the `enabled` kill switch: it decorates the OpenAPI document at build time regardless of the runtime `enabled` setting, so if you disable the interceptor at runtime, stop calling `applyDeprecationDocs` too, to keep docs and runtime behavior in sync.

## Telemetry

`DeprecationModuleOptions.onDeprecatedCall` fires once per request to a deprecated endpoint, after the response headers are written:

```typescript
interface DeprecatedCallEvent {
  method: string;
  route: string; // route PATTERN, e.g. "/orders/:id" — not the concrete URL, to keep metric cardinality low
  controllerName: string;
  handlerName: string;
  metadata: DeprecationMetadata; // the frozen, precomputed decorator options
  isPastSunset: boolean;
}
```

Use it for logging, custom metrics, or any sink you like:

```typescript
DeprecationModule.forRoot({
  onDeprecatedCall: (event) => {
    myMetrics.increment('deprecated_requests', { route: event.route });
  },
});
```

### `./otel` — ready-made OpenTelemetry listener

The `./otel` subpath is optional and requires `@opentelemetry/api`. It calls only the OTel API (never creates or configures a `MeterProvider`) and defaults to the global meter registry:

```typescript
import { DeprecationModule } from '@camcima/nestjs-deprecation';
import { createOtelDeprecationListener } from '@camcima/nestjs-deprecation/otel';

DeprecationModule.forRoot({
  onDeprecatedCall: createOtelDeprecationListener(),
});
```

Pass an explicit `meterProvider` if you don't want the global one:

```typescript
createOtelDeprecationListener({ meterProvider });
```

This registers a counter named `http.server.deprecated_requests` with attributes:

| Attribute                 | Type      | Notes                                                                                                                      |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `http.request.method`     | `string`  | e.g. `"GET"`                                                                                                               |
| `http.route`              | `string`  | route pattern, e.g. `"/orders/:id"`                                                                                        |
| `deprecation.past_sunset` | `boolean` | whether the current time is past the configured sunset date                                                                |
| `deprecation.sunset_date` | `string`  | ISO 8601 sunset date; **omitted** when no `sunsetAt` is set (keeps cardinality low — one value per route, not per request) |

## Strictly informational

`@camcima/nestjs-deprecation` never changes endpoint behavior — not before the deprecation date, not after the sunset date. This is the purest reading of RFC 9745: "the act of deprecation does not change any behavior of the resource." There is no 410-enforcement mode, no brownout/probabilistic-failure mode, and no request blocking of any kind; the library only ever adds response headers and (optionally) fires a telemetry callback.

Enforcement behaviors like returning `410 Gone` past sunset, or scheduled brownouts, were deliberately considered and deferred — see the design spec's [Considered and deferred](docs/superpowers/specs/2026-07-08-nestjs-deprecation-design.md#considered-and-deferred) section for the reasoning. If you need enforcement, build it on top of the `onDeprecatedCall`/`isPastSunset` hook rather than expecting this library to do it for you.

## Known limitations

- **`applyDeprecationDocs` reads each controller's own prototype.** A `@Deprecated()` handler _inherited_ from a base/abstract controller class (rather than declared directly on the concrete controller) is not currently picked up and decorated in the generated OpenAPI document. This is a Swagger-docs-only gap — the runtime `Deprecation`/`Sunset`/`Link` headers, written by the interceptor via `Reflector.getAllAndOverride`, are unaffected and work correctly regardless of inheritance.
- **Header write ordering.** The interceptor writes the `Deprecation`/`Sunset`/`Link` headers _before_ calling the route handler (`next.handle()`), so that they still land on thrown exceptions and streaming responses. A consequence: anything that sets a `Link` header _after_ that point — e.g. inside the handler body itself, or in an interceptor registered to run closer to the handler — will overwrite rather than merge with the deprecation `Link` value. Middleware or an interceptor registered _before_ `DeprecationModule`'s (so it runs first) is appended to correctly instead of overwritten.

## API Reference

| Export                          | Kind             | Description                                                                                       |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `Deprecated`                    | Decorator        | Method or class decorator; emits `DeprecatedOptions` as metadata                                  |
| `DeprecationModule`             | Class            | Dynamic module. Use `forRoot(options?)` or `forRootAsync(options)`                                |
| `DeprecationInterceptor`        | Injectable class | Global interceptor registered by `DeprecationModule`; writes headers and fires `onDeprecatedCall` |
| `DeprecatedOptions`             | Interface        | Options accepted by `@Deprecated()`                                                               |
| `DeprecationMetadata`           | Interface        | Precomputed, frozen wire values stored as Reflect metadata                                        |
| `DeprecatedCallEvent`           | Interface        | Shape of the event passed to `onDeprecatedCall`                                                   |
| `DeprecatedCallListener`        | Type             | `(event: DeprecatedCallEvent) => void`                                                            |
| `DeprecationModuleOptions`      | Interface        | Options accepted by `forRoot()`                                                                   |
| `DeprecationModuleAsyncOptions` | Interface        | Options accepted by `forRootAsync()`                                                              |
| `LinkRelation`                  | Interface        | `{ rel: string; href: string; type?: string }` — one entry in `links`                             |
| `DEPRECATION_METADATA_KEY`      | Constant         | Reflect metadata key under which `@Deprecated()` stores `DeprecationMetadata`                     |
| `DEPRECATION_MODULE_OPTIONS`    | Symbol           | DI token for the module options                                                                   |

**Swagger subpath** (`@camcima/nestjs-deprecation/swagger`):

| Export                        | Kind      | Description                                                                                    |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `applyDeprecationDocs`        | Function  | Auto-applies `deprecated: true` + header docs to discovered controllers via `DiscoveryService` |
| `ApplyDeprecationDocsOptions` | Interface | Options for `applyDeprecationDocs` (`filter`)                                                  |
| `DiscoveredController`        | Interface | Structural controller view passed to the `filter` option                                       |

**OTel subpath** (`@camcima/nestjs-deprecation/otel`):

| Export                           | Kind      | Description                                                            |
| -------------------------------- | --------- | ---------------------------------------------------------------------- |
| `createOtelDeprecationListener`  | Function  | Returns an `onDeprecatedCall` listener that increments an OTel counter |
| `OtelDeprecationListenerOptions` | Interface | Options for `createOtelDeprecationListener` (`meterProvider`)          |
| `DEPRECATED_REQUESTS_METRIC`     | Constant  | `'http.server.deprecated_requests'`                                    |

## Prior art

[`fastapi-deprecation`](https://github.com/fractalvision/fastapi-deprecation) implements RFC 9745/8594 for FastAPI and is broader in scope: post-sunset `410` blocking, scheduled/probabilistic brownouts, WebSocket/SSE support, CDN cache-purge headers. `@camcima/nestjs-deprecation` takes a narrower, strictly-informational stance for NestJS and differentiates on OpenTelemetry-native telemetry (a ready-made listener, rather than a bare callback with DIY Prometheus/Redis wiring) and strict RFC fidelity, including the registered `rel="deprecation"` link relation.

## License

[MIT](./LICENSE)
