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

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DEPRECATION_MODULE_OPTIONS)
    private readonly options: DeprecationModuleOptions = {},
  ) {}

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
        // Write BEFORE next.handle() so headers survive thrown exceptions and
        // are flushed with the first byte of streaming responses.
        this.writeHeaders(context, metadata);
        this.notify(context, metadata);
      }
    } catch (error) {
      this.logger.warn(`Deprecation interceptor skipped: ${String(error)}`);
    }
    return next.handle();
  }

  private writeHeaders(context: ExecutionContext, metadata: DeprecationMetadata): void {
    try {
      // Both Express (Response) and Fastify (Reply) expose header() and getHeader().
      const response = context.switchToHttp().getResponse();
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
      listener({
        method: String(request.method ?? 'UNKNOWN'),
        route: resolveRoutePattern(request),
        controllerName: context.getClass().name,
        handlerName: context.getHandler().name,
        metadata,
        isPastSunset: metadata.sunsetEpochMs !== undefined && Date.now() > metadata.sunsetEpochMs,
      });
    } catch (error) {
      this.logger.warn(`onDeprecatedCall listener threw: ${String(error)}`);
    }
  }
}

/** Route PATTERN across adapters: Fastify v4+ / Fastify v3 / Express / fallback. */
function resolveRoutePattern(request: {
  routeOptions?: { url?: string };
  routerPath?: string;
  route?: { path?: string };
  url?: string;
}): string {
  return (
    request.routeOptions?.url ??
    request.routerPath ??
    request.route?.path ??
    request.url ??
    'unknown'
  );
}
