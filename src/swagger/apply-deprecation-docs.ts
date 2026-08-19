import { INestApplication, Logger, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ApplicationConfig, DiscoveryService, MetadataScanner } from '@nestjs/core';
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
}

export interface ApplyDeprecationDocsOptions {
  /** Return false to skip a controller. Default: include all. */
  filter?: (controller: DiscoveredController) => boolean;
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
}

/**
 * Marks every @Deprecated() endpoint as deprecated in the GIVEN OpenAPI
 * document and documents the Deprecation/Sunset/Link headers on each of its
 * responses. Pure per-document transform: it never touches decorator
 * metadata, so multiple documents (e.g. filtered public vs. internal) are
 * fully independent, and applying it twice to the same document is a no-op.
 *
 * ```typescript
 * const document = SwaggerModule.createDocument(app, config);
 * SwaggerModule.setup('/api', app, applyDeprecationDocs(document, app));
 * ```
 *
 * Requires DiscoveryModule from @nestjs/core in your application module.
 * Routes are matched by recomputing the Nest route path; a global prefix is
 * tolerated via unique suffix match. Unmatchable handlers (e.g. custom URI
 * versioning) are skipped with a warning.
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
  const globalPrefix = resolveGlobalPrefix(app);

  for (const controller of discoveryService.getControllers()) {
    const metatype = controller.metatype;
    if (!metatype) continue;
    if (options?.filter && !options.filter(controller)) continue;

    const classMetadata: DeprecationMetadata | undefined = Reflect.getMetadata(
      DEPRECATION_METADATA_KEY,
      metatype,
    );
    const controllerPaths = toPathArray(Reflect.getMetadata(PATH_METADATA, metatype));
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
      for (const controllerPath of controllerPaths) {
        for (const methodPath of methodPaths) {
          decorateDocumentPath(
            document,
            globalPrefix,
            toOpenApiPath(controllerPath, methodPath),
            requestMethod,
            metadata,
            `${controller.name ?? metatype.name}.${methodName}`,
          );
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

/**
 * The document paths include an application-wide prefix that route metadata
 * knows nothing about. Reading it from the app makes prefixed lookups exact,
 * instead of guessing by suffix and losing to any path that shares one.
 */
function resolveGlobalPrefix(app: INestApplication): string {
  try {
    const prefix = app.get(ApplicationConfig, { strict: false }).getGlobalPrefix();
    if (!prefix) return '';
    const normalized = prefix.replace(/\/+$/, '');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  } catch {
    return ''; // older/mocked apps: fall back to suffix matching alone
  }
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
): void {
  const pathItem = findPathItem(document, globalPrefix, openApiPath);
  if (!pathItem) {
    logger.warn(
      `No OpenAPI path matches "${openApiPath}" for ${where}; skipping. Custom prefixes or URI versioning may not be resolvable.`,
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
    decorateOperation(pathItem[methodKey] as OperationObjectLike, metadata);
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
  // Last resort for prefixes the app does not report (versioning, per-route
  // prefixes): accept a suffix match only when it is unambiguous.
  const matches = Object.keys(document.paths).filter((path) => path.endsWith(openApiPath));
  return matches.length === 1 ? (document.paths[matches[0]] as Record<string, unknown>) : undefined;
}

function decorateOperation(operation: OperationObjectLike, metadata: DeprecationMetadata): void {
  const block = buildDeprecationBlock(metadata);
  if (operation.description?.includes(block)) return; // already applied — keep idempotent
  operation.deprecated = true;
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
