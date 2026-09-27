import {
  INestApplication,
  Logger,
  RequestMethod,
  Type,
  VERSION_NEUTRAL,
  VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_PATH,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import {
  ApplicationConfig,
  DiscoveryService,
  MetadataScanner,
  ModulesContainer,
} from '@nestjs/core';
import { DEPRECATION_METADATA_KEY } from '../deprecation.constants';
import { DeprecationMetadata } from '../deprecation.interfaces';

/**
 * Path-item keys a route can occupy, derived from Nest's own enum so that
 * methods beyond the OpenAPI eight (SEARCH, PROPFIND, ...) — which
 * @nestjs/swagger does emit — are covered without a list to keep in sync.
 */
const ROUTE_METHOD_KEYS: readonly string[] = Object.keys(RequestMethod)
  .filter((key) => Number.isNaN(Number(key)) && key !== 'ALL')
  .map((key) => key.toLowerCase());

const logger = new Logger('applyDeprecationDocs');

/** Structural view of a discovered controller (avoids @nestjs/core internals in public types). */
export interface DiscoveredController {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- supertype of Nest's InstanceWrapper['metatype']
  metatype?: Type<unknown> | Function | null;
  name?: string;
  /** The declaring module, whose RouterModule path prefixes the controller's routes. */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- supertype of Nest's Module['metatype']
  host?: { metatype?: Type<unknown> | Function | null } | null;
}

export interface ApplyDeprecationDocsOptions {
  /** Return false to skip a controller. Default: include all. */
  filter?: (controller: DiscoveredController) => boolean;
  /**
   * Emit the `x-sunset` OpenAPI extension on deprecated operations that have a
   * `sunsetAt`. Read by diff tools (oasdiff) to decide whether removing the
   * operation is a breaking change. Default: true. Set false to opt out.
   */
  xSunset?: boolean;
}

/**
 * The subset of an OpenAPI document this transform touches. The path-item
 * value is `object` (not `Record<string, unknown>`) so that interface types
 * without index signatures — like @nestjs/swagger's PathItemObject — satisfy
 * the constraint.
 */
export interface DeprecationDocumentLike {
  paths: Record<string, object>;
}

interface ResponseObjectLike {
  $ref?: string;
  description?: string;
  headers?: Record<string, unknown>;
}

interface OperationObjectLike {
  deprecated?: boolean;
  description?: string;
  responses?: Record<string, ResponseObjectLike>;
  'x-sunset'?: string;
}

/**
 * Marks every @Deprecated() endpoint as deprecated in the GIVEN OpenAPI
 * document, documents the Deprecation/Sunset/Link headers on each of its
 * responses, and stamps the `x-sunset` extension read by diff tools. Pure per-document transform: it never touches decorator
 * metadata, so multiple documents (e.g. filtered public vs. internal) are
 * fully independent, and applying it twice to the same document is a no-op.
 *
 * ```typescript
 * const document = SwaggerModule.createDocument(app, config);
 * SwaggerModule.setup('/api', app, applyDeprecationDocs(document, app));
 * ```
 *
 * Requires DiscoveryModule from @nestjs/core in your application module.
 * Routes are matched by recomputing the Nest route path the way Nest's router
 * does: global prefix, URI version, RouterModule path, controller path,
 * handler path. Anything else (e.g. custom versioning) falls back to a unique
 * suffix match, and unmatchable handlers are skipped with a warning.
 */
export function applyDeprecationDocs<TDocument extends DeprecationDocumentLike>(
  document: TDocument,
  app: INestApplication,
  options?: ApplyDeprecationDocsOptions,
): TDocument {
  let discoveryService: DiscoveryService;
  try {
    discoveryService = app.get(DiscoveryService);
  } catch (error) {
    throw new Error(
      'applyDeprecationDocs requires DiscoveryModule. Add DiscoveryModule (from @nestjs/core) to your application module imports.',
      { cause: error },
    );
  }

  const scanner = new MetadataScanner();
  const { globalPrefix, uriVersioning } = resolveRouting(app);
  const applicationId = resolveApplicationId(app);
  const xSunset = options?.xSunset !== false;

  for (const controller of discoveryService.getControllers()) {
    const metatype = controller.metatype;
    if (!metatype) continue;
    if (options?.filter && !options.filter(controller)) continue;

    const classMetadata: DeprecationMetadata | undefined = Reflect.getMetadata(
      DEPRECATION_METADATA_KEY,
      metatype,
    );
    const controllerPaths = toPathArray(Reflect.getMetadata(PATH_METADATA, metatype));
    const modulePath = resolveModulePath(controller, applicationId);
    const controllerVersion: unknown = uriVersioning
      ? (Reflect.getMetadata(VERSION_METADATA, metatype) ?? uriVersioning.defaultVersion)
      : undefined;
    const prototype: object | undefined = metatype.prototype;
    if (!prototype) continue;

    // getAllMethodNames walks the prototype chain, so handlers inherited from
    // a base controller are documented too.
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = findHandler(prototype, methodName);
      if (!handler) continue;

      const requestMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (requestMethod === undefined) continue; // not a routed handler

      const metadata: DeprecationMetadata | undefined =
        Reflect.getMetadata(DEPRECATION_METADATA_KEY, handler) ?? classMetadata;
      if (!metadata) continue;

      const methodPaths = toPathArray(Reflect.getMetadata(PATH_METADATA, handler));
      // Without these segments a versioned route resolves to the unversioned
      // path, which is an exact match for a different, version-neutral route.
      const versionSegments = uriVersioning
        ? toVersionSegments(
            Reflect.getMetadata(VERSION_METADATA, handler) ?? controllerVersion,
            uriVersioning.prefix,
          )
        : [''];
      for (const versionSegment of versionSegments) {
        for (const controllerPath of controllerPaths) {
          for (const methodPath of methodPaths) {
            decorateDocumentPath(
              document,
              globalPrefix,
              toOpenApiPath(`${versionSegment}/${modulePath}/${controllerPath}`, methodPath),
              requestMethod,
              metadata,
              `${controller.name ?? metatype.name}.${methodName}`,
              xSunset,
            );
          }
        }
      }
    }
  }
  return document;
}

/** Resolves an own or inherited method without invoking accessors. */
function findHandler(prototype: object, name: string): object | undefined {
  for (
    let current: object | null = prototype;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return typeof descriptor.value === 'function' ? descriptor.value : undefined;
  }
  return undefined;
}

interface UriVersioning {
  prefix: string;
  defaultVersion: unknown;
}

/**
 * The document paths include an application-wide prefix and URI version
 * segments that route metadata knows nothing about. Reading them from the app
 * makes lookups exact, instead of guessing by suffix and losing to any path
 * that shares one.
 */
function resolveRouting(app: INestApplication): {
  globalPrefix: string;
  uriVersioning?: UriVersioning;
} {
  let config: ApplicationConfig;
  try {
    config = app.get(ApplicationConfig, { strict: false });
  } catch {
    return { globalPrefix: '' }; // older/mocked apps: fall back to suffix matching alone
  }
  const prefix = config.getGlobalPrefix();
  const normalized = prefix ? prefix.replace(/\/+$/, '') : '';
  const globalPrefix = !normalized || normalized.startsWith('/') ? normalized : `/${normalized}`;
  // Optional call: test doubles and older configs may not implement it.
  const versioning: VersioningOptions | undefined = config.getVersioning?.();
  if (versioning?.type !== VersioningType.URI) return { globalPrefix };
  return {
    globalPrefix,
    uriVersioning: {
      // Mirrors Nest's RoutePathFactory: "v" unless overridden, "" when false.
      prefix: versioning.prefix === false ? '' : (versioning.prefix ?? 'v'),
      defaultVersion: versioning.defaultVersion,
    },
  };
}

/** RouterModule stores module paths under a per-application metadata key. */
function resolveApplicationId(app: INestApplication): string | undefined {
  try {
    return app.get(ModulesContainer, { strict: false }).applicationId;
  } catch {
    return undefined;
  }
}

function resolveModulePath(
  controller: DiscoveredController,
  applicationId: string | undefined,
): string {
  const moduleType = controller.host?.metatype;
  if (!moduleType) return '';
  const path: unknown =
    (applicationId === undefined
      ? undefined
      : Reflect.getMetadata(MODULE_PATH + applicationId, moduleType)) ??
    Reflect.getMetadata(MODULE_PATH, moduleType);
  return typeof path === 'string' ? path : '';
}

/** A route's URI version segments; "" is the unversioned (neutral) path. */
function toVersionSegments(version: unknown, prefix: string): string[] {
  if (version === undefined) return [''];
  const versions: unknown[] = Array.isArray(version) ? version : [version];
  return versions.map((v) => (v === VERSION_NEUTRAL ? '' : `${prefix}${String(v)}`));
}

function toPathArray(path: string | string[] | undefined): string[] {
  if (path === undefined) return ['/'];
  return Array.isArray(path) ? path : [path];
}

/** "/orders" + "/:id" -> "/orders/{id}" (Nest route syntax to OpenAPI braces). */
function toOpenApiPath(controllerPath: string, methodPath: string): string {
  const joined = `/${controllerPath}/${methodPath}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  return (
    joined
      // path-to-regexp v8 optional groups: "opt{/:id}" -> "opt/:id"
      .replace(/[{}]/g, '')
      // ":id", and Express 4's constrained ":id(\\d+)" -> "{id}"
      .replace(/:([A-Za-z0-9_]+)(\([^)]*\))?/g, '{$1}')
      // named wildcards: "*splat" -> "{splat}"
      .replace(/\*([A-Za-z0-9_]+)/g, '{$1}')
  );
}

function decorateDocumentPath(
  document: DeprecationDocumentLike,
  globalPrefix: string,
  openApiPath: string,
  requestMethod: number,
  metadata: DeprecationMetadata,
  where: string,
  xSunset: boolean,
): void {
  const pathItem = findPathItem(document, globalPrefix, openApiPath);
  if (!pathItem) {
    logger.warn(
      `No OpenAPI path matches "${openApiPath}" for ${where}; skipping. Custom versioning or per-route prefixes may not be resolvable.`,
    );
    return;
  }
  const methodKeys =
    requestMethod === RequestMethod.ALL
      ? ROUTE_METHOD_KEYS.filter((method) => pathItem[method] !== undefined)
      : ROUTE_METHOD_KEYS.filter(
          (method) =>
            method === RequestMethod[requestMethod]?.toLowerCase() &&
            pathItem[method] !== undefined,
        );
  if (methodKeys.length === 0) {
    logger.warn(
      `OpenAPI path "${openApiPath}" has no operation for ${where}'s request method; skipping.`,
    );
    return;
  }
  for (const methodKey of methodKeys) {
    decorateOperation(pathItem[methodKey] as OperationObjectLike, metadata, xSunset);
  }
}

function findPathItem(
  document: DeprecationDocumentLike,
  globalPrefix: string,
  openApiPath: string,
): Record<string, unknown> | undefined {
  const candidates = globalPrefix ? [`${globalPrefix}${openApiPath}`, openApiPath] : [openApiPath];
  for (const candidate of candidates) {
    const exact = document.paths[candidate];
    if (exact) return exact as Record<string, unknown>;
  }
  if (openApiPath === '/') return undefined;
  // Last resort for prefixes the app does not report (custom versioning,
  // per-route prefixes): accept a suffix match only when it is unambiguous.
  const matches = Object.keys(document.paths).filter((path) => path.endsWith(openApiPath));
  return matches.length === 1 ? (document.paths[matches[0]] as Record<string, unknown>) : undefined;
}

function decorateOperation(
  operation: OperationObjectLike,
  metadata: DeprecationMetadata,
  xSunset: boolean,
): void {
  const block = buildDeprecationBlock(metadata);
  if (operation.description?.includes(block)) return; // already applied — keep idempotent
  operation.deprecated = true;
  // Date-only (RFC 3339 full-date): the form every oasdiff example uses, and
  // the same slice the description block shows, so the two cannot disagree.
  // A hand-authored value wins, as with the response headers below.
  if (xSunset && metadata.sunsetAtIso && operation['x-sunset'] === undefined) {
    operation['x-sunset'] = metadata.sunsetAtIso.slice(0, 10);
  }
  operation.description = operation.description ? `${operation.description}\n\n${block}` : block;

  const responses = (operation.responses ??= {});
  if (Object.keys(responses).length === 0) {
    responses.default = { description: 'Deprecation signalling headers (RFC 9745 / RFC 8594)' };
  }
  const headerDocs = buildHeaderDocs(metadata);
  for (const response of Object.values(responses)) {
    if (!response || response.$ref !== undefined) continue; // cannot annotate $ref responses
    const headers = (response.headers ??= {});
    // HTTP header names are case-insensitive, so a user-authored "link" entry
    // must suppress ours — adding "Link" beside it would leave the document
    // with two definitions of one header.
    const documented = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
    for (const [name, doc] of Object.entries(headerDocs)) {
      if (documented.has(name.toLowerCase())) continue;
      headers[name] = doc;
    }
  }
}

function buildDeprecationBlock(metadata: DeprecationMetadata): string {
  const lines = [`**Deprecated** since ${metadata.deprecatedAtIso.slice(0, 10)}.`];
  if (metadata.sunsetAtIso) lines.push(`**Sunset**: ${metadata.sunsetAtIso.slice(0, 10)}.`);
  if (metadata.note) lines.push(metadata.note);
  if (metadata.linkHeader) lines.push(`Links: \`${metadata.linkHeader}\``);
  return lines.join('\n\n');
}

type HeaderDoc = { description: string; schema: { type: 'string'; example: string } };

function buildHeaderDocs(metadata: DeprecationMetadata): Record<string, HeaderDoc> {
  const headers: Record<string, HeaderDoc> = {
    Deprecation: {
      description: 'RFC 9745 deprecation date (structured-field date, unix seconds)',
      schema: { type: 'string', example: metadata.deprecationHeader },
    },
  };
  if (metadata.sunsetHeader) {
    headers.Sunset = {
      description: 'RFC 8594 sunset date (HTTP-date): when the endpoint stops working',
      schema: { type: 'string', example: metadata.sunsetHeader },
    };
  }
  if (metadata.linkHeader) {
    headers.Link = {
      description: 'RFC 8288 links: deprecation documentation and successor version',
      schema: { type: 'string', example: metadata.linkHeader },
    };
  }
  return headers;
}
