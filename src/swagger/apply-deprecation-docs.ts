import { INestApplication, Type } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DEPRECATION_METADATA_KEY } from '../deprecation.constants';
import { DeprecationMetadata } from '../deprecation.interfaces';

// @nestjs/swagger stores @ApiOperation metadata under this key (its
// DECORATORS.API_OPERATION constant). Read here to merge rather than clobber
// user-set summaries. The swagger e2e test fails loudly if a future
// @nestjs/swagger version relocates it.
const API_OPERATION_METADATA_KEY = 'swagger/apiOperation';

// The OpenAPI metadata mutated by decorateOperation() lives on the controller
// class (via reflect-metadata on the handler function), which is shared
// across every app that imports the controller. applyDeprecationDocs is
// documented to run inside the SwaggerModule.setup(..., factory) callback,
// which Nest may invoke more than once for the same app. Without this guard,
// each additional run would append another duplicate deprecation block.
// Track processed handlers here so each one is decorated at most once, ever.
const decoratedHandlers = new WeakSet<object>();

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
 * Marks every @Deprecated() endpoint as deprecated in the OpenAPI document
 * and documents the Deprecation/Sunset/Link response headers.
 *
 * Call inside the lazy document factory so decoration happens before the
 * document is created:
 *
 * ```typescript
 * SwaggerModule.setup('/api', app, () => {
 *   applyDeprecationDocs(app);
 *   return SwaggerModule.createDocument(app, config);
 * });
 * ```
 *
 * Requires DiscoveryModule from @nestjs/core in your application module.
 */
export function applyDeprecationDocs(
  app: INestApplication,
  options?: ApplyDeprecationDocsOptions,
): void {
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
    const prototype = metatype.prototype as Record<string, unknown>;

    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const metadata: DeprecationMetadata | undefined =
        Reflect.getMetadata(DEPRECATION_METADATA_KEY, descriptor.value) ?? classMetadata;
      if (!metadata) continue;

      if (decoratedHandlers.has(descriptor.value)) continue;
      decoratedHandlers.add(descriptor.value);

      decorateOperation(prototype, methodName, descriptor, metadata);
    }
  }
}

function decorateOperation(
  prototype: object,
  methodName: string,
  descriptor: PropertyDescriptor,
  metadata: DeprecationMetadata,
): void {
  const existing: { description?: string } =
    Reflect.getMetadata(API_OPERATION_METADATA_KEY, descriptor.value) ?? {};

  ApiOperation({
    ...existing,
    deprecated: true,
    description: appendDeprecationBlock(existing.description, metadata),
  })(prototype, methodName, descriptor);

  ApiResponse({
    status: 'default',
    description: 'Deprecation signalling headers (RFC 9745 / RFC 8594)',
    headers: buildHeaderDocs(metadata),
  })(prototype, methodName, descriptor);
}

function appendDeprecationBlock(
  existingDescription: string | undefined,
  metadata: DeprecationMetadata,
): string {
  const lines = [`**Deprecated** since ${metadata.deprecatedAtIso.slice(0, 10)}.`];
  if (metadata.sunsetAtIso) lines.push(`**Sunset**: ${metadata.sunsetAtIso.slice(0, 10)}.`);
  if (metadata.note) lines.push(metadata.note);
  if (metadata.linkHeader) lines.push(`Links: \`${metadata.linkHeader}\``);
  const block = lines.join('\n\n');
  return existingDescription ? `${existingDescription}\n\n${block}` : block;
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
