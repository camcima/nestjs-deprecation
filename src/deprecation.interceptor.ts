import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
  Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { DEPRECATION_METADATA_KEY, DEPRECATION_MODULE_OPTIONS } from './deprecation.constants';
import { DeprecationMetadata, DeprecationModuleOptions } from './deprecation.interfaces';

/**
 * Per-request "already signalled" marker. Registered globally by key so that
 * two copies of this package in one dependency tree still dedupe each other.
 */
const SIGNALLED = Symbol.for('camcima:nestjs-deprecation:signalled');

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeprecationInterceptor.name);
  private readonly options: DeprecationModuleOptions;
  private readonly metadataCache = new WeakMap<
    object,
    WeakMap<object, DeprecationMetadata | null>
  >();

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

      const metadata = this.resolveMetadata(context.getHandler(), context.getClass());
      if (metadata) {
        const http = context.switchToHttp();
        const request = http.getRequest<RouteCarrier>();
        // Tolerate duplicate module registration (forRoot() imported twice
        // creates two interceptor instances): the first writer wins; later
        // instances skip so Link relations and telemetry are not duplicated.
        if (!this.claimRequest(request)) {
          // Write BEFORE next.handle() so headers survive thrown exceptions and
          // are flushed with the first byte of streaming responses.
          this.writeHeaders(http.getResponse(), metadata);
          this.notify(context, request, metadata);
        }
      }
    } catch (error) {
      this.logger.warn(`Deprecation interceptor skipped: ${String(error)}`);
    }
    return next.handle();
  }

  /**
   * Decorator metadata is built once at boot and frozen, so it is resolved
   * once per (handler, controller) pair rather than on every request — this
   * interceptor is global and runs on undeprecated routes too. Keyed by
   * controller as well as handler because an inherited handler resolves
   * against each subclass's own class-level metadata. Both keys are held
   * weakly, so nothing outlives the classes it came from.
   */
  private resolveMetadata(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- what ExecutionContext.getHandler() returns
    handler: Function,
    controller: Type<unknown>,
  ): DeprecationMetadata | undefined {
    let byController = this.metadataCache.get(handler);
    if (byController === undefined) {
      byController = new WeakMap();
      this.metadataCache.set(handler, byController);
    }
    const cached = byController.get(controller);
    if (cached !== undefined) return cached ?? undefined;

    const resolved =
      this.reflector.getAllAndOverride<DeprecationMetadata | undefined>(DEPRECATION_METADATA_KEY, [
        handler,
        controller,
      ]) ?? null;
    byController.set(controller, resolved);
    return resolved ?? undefined;
  }

  /**
   * Claims this request for the first interceptor instance that reaches it,
   * returning true when another instance already did.
   *
   * The marker lives on the request, not on the response headers: sibling
   * instances share the request object, while a `Deprecation` header written
   * by unrelated middleware (e.g. an app migrating off a hand-rolled solution)
   * must not suppress this library's own Sunset/Link writes and telemetry.
   */
  private claimRequest(request: unknown): boolean {
    if (typeof request !== 'object' || request === null) return false;
    const marked = request as Record<PropertyKey, unknown>;
    if (marked[SIGNALLED] === true) return true;
    try {
      marked[SIGNALLED] = true;
    } catch {
      // A frozen request cannot carry the marker. Signalling twice under
      // duplicate registration beats not signalling at all.
    }
    return false;
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

  private notify(
    context: ExecutionContext,
    request: RouteCarrier,
    metadata: DeprecationMetadata,
  ): void {
    const listener = this.options.onDeprecatedCall;
    if (!listener) return;
    try {
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
export function validateModuleOptions(options: unknown): DeprecationModuleOptions {
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

/** The route-pattern fields this library reads, across adapters. */
interface RouteCarrier {
  method?: unknown;
  routeOptions?: { url?: string };
  routerPath?: string;
  route?: { path?: string };
}

/**
 * Route PATTERN across adapters: Fastify v4+ / Fastify v3 / Express.
 * Deliberately never falls back to request.url: a concrete URL carries path
 * ids and query strings, breaking the documented low-cardinality guarantee.
 */
function resolveRoutePattern(request: RouteCarrier): string {
  return request.routeOptions?.url ?? request.routerPath ?? request.route?.path ?? 'unknown';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}
