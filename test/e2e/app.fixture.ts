import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Module,
  NestInterceptor,
  Provider,
  StreamableFile,
  Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { Readable } from 'node:stream';
import { Deprecated, DeprecationModule, DeprecationModuleOptions } from '../../src';

@Controller('orders')
export class OrdersController {
  @Deprecated({
    deprecatedAt: '2026-07-01T00:00:00Z',
    sunsetAt: '2027-01-01T00:00:00Z',
    link: 'https://docs.example.com/deprecations/orders-v1',
    successor: '/v2/orders',
    note: 'Use POST /v2/orders',
  })
  @Get()
  list() {
    return [{ id: 1 }];
  }

  @Get('fresh')
  fresh() {
    return { fresh: true };
  }

  @Deprecated({ deprecatedAt: '2020-01-01T00:00:00Z', sunsetAt: '2020-06-01T00:00:00Z' })
  @Get('failing')
  failing() {
    throw new HttpException('boom', 500);
  }

  @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
  @Get('stream')
  stream(): StreamableFile {
    return new StreamableFile(Readable.from(['chunk-1', 'chunk-2']));
  }

  @ApiOperation({ summary: 'Documented list', description: 'User-authored description.' })
  @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z', sunsetAt: '2027-01-01T00:00:00Z' })
  @Get('documented')
  documented() {
    return { documented: true };
  }

  @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
  @Get(':id')
  byId() {
    return { id: 42 };
  }
}

@Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z', sunsetAt: '2027-01-01T00:00:00Z' })
@Controller('legacy')
export class LegacyController {
  @Get()
  list() {
    return [];
  }
}

/**
 * Sets a Link header BEFORE the deprecation interceptor runs, to prove the
 * deprecation Link is appended, not overwritten. Registered ahead of
 * DeprecationModule so its APP_INTERCEPTOR executes first.
 */
@Injectable()
export class LinkSettingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context.switchToHttp().getResponse().header('Link', '</orders?page=2>; rel="next"');
    return next.handle();
  }
}

export function createAppModule(
  options: DeprecationModuleOptions = {},
  extraProviders: Provider[] = [],
): Type<unknown> {
  @Module({
    imports: [DiscoveryModule, DeprecationModule.forRoot(options)],
    controllers: [OrdersController, LegacyController],
    providers: extraProviders,
  })
  class AppModule {}
  return AppModule;
}

export const linkSettingProvider: Provider = {
  provide: APP_INTERCEPTOR,
  useClass: LinkSettingInterceptor,
};
