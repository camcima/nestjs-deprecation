import { INestApplication, Logger, RequestMethod, Type } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { DEPRECATION_METADATA_KEY } from '../deprecation.constants';
import { DeprecationMetadata } from '../deprecation.interfaces';

// Metadata keys written by @nestjs/common's @Controller/@Get/... decorators
// (its PATH_METADATA / METHOD_METADATA constants). The string values are
// stable public wire format since Nest v4; the e2e suite fails loudly if a
// future version relocates them.
const PATH_METADATA_KEY = 'path';
const METHOD_METADATA_KEY = 'method';

const OPENAPI_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

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

  for (const controller of discoveryService.getControllers()) {
    const metatype = controller.metatype;
    if (!metatype) continue;
    if (options?.filter && !options.filter(controller)) continue;

    const classMetadata: DeprecationMetadata | undefined = Reflect.getMetadata(
      DEPRECATION_METADATA_KEY,
      metatype,
    );
    const controllerPaths = toPathArray(Reflect.getMetadata(PATH_METADATA_KEY, metatype));
    const prototype = metatype.prototype as Record<string, unknown>;

    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const requestMethod: number | undefined = Reflect.getMetadata(
        METHOD_METADATA_KEY,
        descriptor.value,
      );
      if (requestMethod === undefined) continue; // not a routed handler

      const metadata: DeprecationMetadata | undefined =
        Reflect.getMetadata(DEPRECATION_METADATA_KEY, descriptor.value) ?? classMetadata;
      if (!metadata) continue;

      const methodPaths = toPathArray(Reflect.getMetadata(PATH_METADATA_KEY, descriptor.value));
      for (const controllerPath of controllerPaths) {
        for (const methodPath of methodPaths) {
          decorateDocumentPath(
            document,
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

function toPathArray(path: string | string[] | undefined): string[] {
  if (path === undefined) return ['/'];
  return Array.isArray(path) ? path : [path];
}

/** "/orders" + "/:id" -> "/orders/{id}" (Express-style params to OpenAPI braces). */
function toOpenApiPath(controllerPath: string, methodPath: string): string {
  const joined = `/${controllerPath}/${methodPath}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  return joined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function decorateDocumentPath(
  document: DeprecationDocumentLike,
  openApiPath: string,
  requestMethod: number,
  metadata: DeprecationMetadata,
  where: string,
): void {
  const pathItem = findPathItem(document, openApiPath);
  if (!pathItem) {
    logger.warn(
      `No OpenAPI path matches "${openApiPath}" for ${where}; skipping. Custom prefixes or URI versioning may not be resolvable.`,
    );
    return;
  }
  const methodKeys =
    requestMethod === RequestMethod.ALL
      ? OPENAPI_METHODS.filter((method) => pathItem[method] !== undefined)
      : OPENAPI_METHODS.filter(
          (method) =>
            method === RequestMethod[requestMethod]?.toLowerCase() &&
            pathItem[method] !== undefined,
        );
  for (const methodKey of methodKeys) {
    decorateOperation(pathItem[methodKey] as OperationObjectLike, metadata);
  }
}

function findPathItem(
  document: DeprecationDocumentLike,
  openApiPath: string,
): Record<string, unknown> | undefined {
  const exact = document.paths[openApiPath];
  if (exact) return exact as Record<string, unknown>;
  if (openApiPath === '/') return undefined;
  // Tolerate a global prefix the document includes but route metadata lacks.
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
    for (const [name, doc] of Object.entries(headerDocs)) {
      headers[name] ??= doc; // never clobber user-authored header docs
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
