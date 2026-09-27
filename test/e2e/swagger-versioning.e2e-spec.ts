import 'reflect-metadata';
import {
  Controller,
  DynamicModule,
  Get,
  INestApplication,
  Module,
  Type,
  Version,
  VERSION_NEUTRAL,
  VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import { DiscoveryModule, RouterModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Deprecated, DeprecationModule } from '../../src';
import { applyDeprecationDocs } from '../../src/swagger';

const DEPRECATION = { deprecatedAt: '2026-07-01T00:00:00Z', sunsetAt: '2027-01-01T00:00:00Z' };

@Deprecated(DEPRECATION)
@Controller({ path: 'orders', version: '1' })
class OrdersV1Controller {
  @Get()
  list() {
    return [];
  }
}

@Controller('orders')
class OrdersNeutralController {
  @Get()
  list() {
    return [];
  }
}

@Controller({ path: 'invoices', version: '2' })
class InvoicesController {
  @Deprecated(DEPRECATION)
  @Version('1')
  @Get()
  listV1() {
    return [];
  }

  @Get()
  list() {
    return [];
  }
}

@Deprecated(DEPRECATION)
@Controller({ path: 'reports', version: ['1', VERSION_NEUTRAL] })
class ReportsController {
  @Get()
  list() {
    return [];
  }
}

@Controller({ path: 'reports', version: '2' })
class ReportsV2Controller {
  @Get()
  list() {
    return [];
  }
}

@Deprecated(DEPRECATION)
@Controller('customers')
class CustomersController {
  @Get()
  list() {
    return [];
  }
}

@Controller({ path: 'customers', version: VERSION_NEUTRAL })
class CustomersNeutralController {
  @Get('search')
  search() {
    return [];
  }
}

async function documentFor(
  controllers: Type<unknown>[],
  versioning: VersioningOptions,
  configure?: (app: INestApplication) => void,
  extraImports: Array<Type<unknown> | DynamicModule> = [],
) {
  @Module({ imports: [DiscoveryModule, DeprecationModule.forRoot(), ...extraImports], controllers })
  class AppModule {}
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.enableVersioning(versioning);
  configure?.(app);
  await app.init();
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    applyDeprecationDocs(document, app);
    return Object.fromEntries(
      Object.entries(document.paths).map(([path, item]) => [
        path,
        {
          deprecated: item.get?.deprecated === true,
          sunset: (item.get as Record<string, unknown> | undefined)?.['x-sunset'],
        },
      ]),
    );
  } finally {
    await app.close();
  }
}

describe('applyDeprecationDocs with URI versioning', () => {
  it('marks the versioned operation, not a version-neutral one sharing its path', async () => {
    const paths = await documentFor([OrdersV1Controller, OrdersNeutralController], {
      type: VersioningType.URI,
    });
    expect(paths['/v1/orders']).toEqual({ deprecated: true, sunset: '2027-01-01' });
    expect(paths['/orders']).toEqual({ deprecated: false, sunset: undefined });
  });

  it('lets a handler-level @Version() override the controller version', async () => {
    const paths = await documentFor([InvoicesController], { type: VersioningType.URI });
    expect(paths['/v1/invoices'].deprecated).toBe(true);
    expect(paths['/v2/invoices'].deprecated).toBe(false);
  });

  it('marks every path of a multi-version route, including the neutral one', async () => {
    const paths = await documentFor([ReportsController, ReportsV2Controller], {
      type: VersioningType.URI,
    });
    expect(paths['/v1/reports'].deprecated).toBe(true);
    expect(paths['/reports'].deprecated).toBe(true);
    expect(paths['/v2/reports'].deprecated).toBe(false);
  });

  it('applies the default version to unversioned controllers', async () => {
    const paths = await documentFor([CustomersController, CustomersNeutralController], {
      type: VersioningType.URI,
      defaultVersion: '3',
    });
    expect(paths['/v3/customers'].deprecated).toBe(true);
    expect(paths['/customers/search'].deprecated).toBe(false);
  });

  it('honours a custom version prefix', async () => {
    const paths = await documentFor([OrdersV1Controller, OrdersNeutralController], {
      type: VersioningType.URI,
      prefix: 'version-',
    });
    expect(paths['/version-1/orders'].deprecated).toBe(true);
    expect(paths['/orders'].deprecated).toBe(false);
  });

  it('honours a disabled version prefix', async () => {
    const paths = await documentFor([OrdersV1Controller], {
      type: VersioningType.URI,
      prefix: false,
    });
    expect(paths['/1/orders'].deprecated).toBe(true);
  });

  it('places the version after the global prefix', async () => {
    const paths = await documentFor(
      [OrdersV1Controller, OrdersNeutralController],
      { type: VersioningType.URI },
      (app) => app.setGlobalPrefix('api'),
    );
    expect(paths['/api/v1/orders'].deprecated).toBe(true);
    expect(paths['/api/orders'].deprecated).toBe(false);
  });

  it('places a RouterModule path between the version and the controller path', async () => {
    @Module({ controllers: [OrdersV1Controller] })
    class AdminModule {}
    @Module({ controllers: [OrdersNeutralController] })
    class PublicModule {}
    const paths = await documentFor([], { type: VersioningType.URI }, undefined, [
      AdminModule,
      PublicModule,
      RouterModule.register([
        { path: 'admin', module: AdminModule },
        { path: 'public', module: PublicModule },
      ]),
    ]);
    expect(paths['/v1/admin/orders'].deprecated).toBe(true);
    expect(paths['/public/orders'].deprecated).toBe(false);
  });
});
