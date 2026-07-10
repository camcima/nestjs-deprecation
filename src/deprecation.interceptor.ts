import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { DEPRECATION_METADATA_KEY, DEPRECATION_MODULE_OPTIONS } from './deprecation.constants';
import { DeprecationMetadata, DeprecationModuleOptions } from './deprecation.interfaces';

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeprecationInterceptor.name);
  private readonly options: DeprecationModuleOptions;

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DEPRECATION_MODULE_OPTIONS)
    options?: DeprecationModuleOptions,
  ) {
    this.options = validateModuleOptions(options);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    try {
      if (this.options.enabled === false || context.getType() !== 'http') {
        return next.handle();
      }

      const metadata = this.reflector.getAllAndOverride<DeprecationMetadata | undefined>(
        DEPRECATION_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (metadata) {
        const response = context.switchToHttp().getResponse();
        // Tolerate duplicate module registration (forRoot() imported twice
        // creates two interceptor instances): the first writer wins; later
        // instances skip so Link relations and telemetry are not duplicated.
        if (response.getHeader?.('Deprecation') === undefined) {
          // Write BEFORE next.handle() so headers survive thrown exceptions and
          // are flushed with the first byte of streaming responses.
          this.writeHeaders(response, metadata);
          this.notify(context, metadata);
        }
      }
    } catch (error) {
      this.logger.warn(`Deprecation interceptor skipped: ${String(error)}`);
    }
    return next.handle();
  }

  private writeHeaders(
    // Both Express (Response) and Fastify (Reply) expose header() and getHeader().
    response: {
      header: (name: string, value: string) => unknown;
      getHeader?: (name: string) => unknown;
    },
    metadata: DeprecationMetadata,
  ): void {
    try {
      response.header('Deprecation', metadata.deprecationHeader);
      if (metadata.sunsetHeader !== undefined) {
        response.header('Sunset', metadata.sunsetHeader);
      }
      if (metadata.linkHeader !== undefined) {
        const existing = response.getHeader?.('Link');
        response.header(
          'Link',
          existing ? `${String(existing)}, ${metadata.linkHeader}` : metadata.linkHeader,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to write deprecation headers: ${String(error)}`);
    }
  }

  private notify(context: ExecutionContext, metadata: DeprecationMetadata): void {
    const listener = this.options.onDeprecatedCall;
    if (!listener) return;
    try {
      const request = context.switchToHttp().getRequest();
      const result: unknown = listener({
        method: String(request.method ?? 'UNKNOWN'),
        route: resolveRoutePattern(request),
        controllerName: context.getClass().name,
        handlerName: context.getHandler().name,
        metadata,
        isPastSunset: metadata.sunsetEpochMs !== undefined && Date.now() > metadata.sunsetEpochMs,
      });
      if (isThenable(result)) {
        result.then(undefined, (error) => {
          this.logger.warn(`onDeprecatedCall listener rejected: ${String(error)}`);
        });
      }
    } catch (error) {
      this.logger.warn(`onDeprecatedCall listener threw: ${String(error)}`);
    }
  }
}

/**
 * Fail closed at boot: a misconfigured module (e.g. a forRootAsync factory
 * returning null) must be a DI instantiation error, not a silent per-request
 * disablement of deprecation signalling.
 */
function validateModuleOptions(options: unknown): DeprecationModuleOptions {
  if (options === undefined) return {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    const got = options === null ? 'null' : Array.isArray(options) ? 'array' : typeof options;
    throw new Error(
      `[nestjs-deprecation] DeprecationModule options must be an object, got: ${got}. Check your forRoot()/forRootAsync() configuration.`,
    );
  }
  const { enabled, onDeprecatedCall } = options as DeprecationModuleOptions;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error(`[nestjs-deprecation] DeprecationModule "enabled" must be a boolean.`);
  }
  if (onDeprecatedCall !== undefined && typeof onDeprecatedCall !== 'function') {
    throw new Error(
      `[nestjs-deprecation] DeprecationModule "onDeprecatedCall" must be a function.`,
    );
  }
  return options as DeprecationModuleOptions;
}

/**
 * Route PATTERN across adapters: Fastify v4+ / Fastify v3 / Express.
 * Deliberately never falls back to request.url: a concrete URL carries path
 * ids and query strings, breaking the documented low-cardinality guarantee.
 */
function resolveRoutePattern(request: {
  routeOptions?: { url?: string };
  routerPath?: string;
  route?: { path?: string };
}): string {
  return request.routeOptions?.url ?? request.routerPath ?? request.route?.path ?? 'unknown';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}
