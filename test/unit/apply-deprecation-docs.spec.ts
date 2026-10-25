import 'reflect-metadata';
import { All, Controller, Get, INestApplication, Logger, Post } from '@nestjs/common';
import { MODULE_PATH } from '@nestjs/common/constants';
import { ApplicationConfig, DiscoveryService } from '@nestjs/core';
import { Deprecated } from '../../src/deprecated.decorator';
import { applyDeprecationDocs } from '../../src/swagger';

/**
 * Route syntax differs across supported Nest majors (path-to-regexp v0 vs v8),
 * but decorators only record the path string — no router is involved in this
 * transform. Driving it with a stub application keeps every syntax case
 * meaningful on every peer version, instead of only the installed one.
 */
function stubApp(controllers: object[], globalPrefix = ''): INestApplication {
  return {
    get: (token: unknown) => {
      if (token === DiscoveryService) {
        return {
          getControllers: () =>
            controllers.map((metatype) => ({
              metatype,
              name: (metatype as { name: string }).name,
            })),
        };
      }
      if (token === ApplicationConfig) return { getGlobalPrefix: () => globalPrefix };
      throw new Error(`stubApp: unexpected token ${String(token)}`);
    },
  } as unknown as INestApplication;
}

function documentWith(...paths: string[]) {
  return {
    paths: Object.fromEntries(paths.map((path) => [path, { get: {} as Record<string, unknown> }])),
  };
}

describe('applyDeprecationDocs', () => {
  it.each([
    [':id', '/assets/{id}'],
    [':id(\\d+)', '/assets/{id}'],
    ['files/*splat', '/assets/files/{splat}'],
    ['opt{/:id}', '/assets/opt/{id}'],
  ])('translates the route path %j to %j', (routePath, openApiPath) => {
    @Controller('assets')
    class AssetsController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get(routePath)
      handler() {
        return null;
      }
    }

    const document = documentWith(openApiPath);
    applyDeprecationDocs(document, stubApp([AssetsController]));
    expect(document.paths[openApiPath].get.deprecated).toBe(true);
  });

  it.each(['api', '/api', 'api/'])(
    'resolves the global prefix %j exactly, not by suffix',
    (prefix) => {
      @Controller('orders')
      class OrdersController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        @Get()
        list() {
          return null;
        }
      }

      // Both paths end in "/orders", so a suffix match is ambiguous.
      const document = documentWith('/api/orders', '/api/internal/orders');
      applyDeprecationDocs(document, stubApp([OrdersController], prefix));
      expect(document.paths['/api/orders'].get.deprecated).toBe(true);
      expect(document.paths['/api/internal/orders'].get.deprecated).toBeUndefined();
    },
  );

  it('still resolves an unambiguous suffix when no prefix is reported', () => {
    @Controller('orders')
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get()
      list() {
        return null;
      }
    }

    const document = documentWith('/v1/orders');
    applyDeprecationDocs(document, stubApp([OrdersController]));
    expect(document.paths['/v1/orders'].get.deprecated).toBe(true);
  });

  it('falls back to suffix matching when the app cannot report a prefix', () => {
    @Controller('orders')
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get()
      list() {
        return null;
      }
    }

    const app = {
      get: (token: unknown) => {
        if (token === DiscoveryService) {
          return {
            getControllers: () => [{ metatype: OrdersController, name: 'OrdersController' }],
          };
        }
        throw new Error('ApplicationConfig is not available');
      },
    } as unknown as INestApplication;

    const document = documentWith('/v1/orders');
    applyDeprecationDocs(document, app);
    expect(document.paths['/v1/orders'].get.deprecated).toBe(true);
  });

  it('marks every documented method of an @All() route', () => {
    @Controller('orders')
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @All('any')
      any() {
        return null;
      }
    }

    const document = {
      paths: {
        '/orders/any': {
          get: {} as Record<string, unknown>,
          post: {} as Record<string, unknown>,
          delete: {} as Record<string, unknown>,
        },
      },
    };
    applyDeprecationDocs(document, stubApp([OrdersController]));
    expect(document.paths['/orders/any'].get.deprecated).toBe(true);
    expect(document.paths['/orders/any'].post.deprecated).toBe(true);
    expect(document.paths['/orders/any'].delete.deprecated).toBe(true);
  });

  it('warns and skips when no document path matches, rather than mis-annotating', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      @Controller('orders')
      class OrdersController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        @Get()
        list() {
          return null;
        }
      }

      const document = documentWith('/unrelated');
      applyDeprecationDocs(document, stubApp([OrdersController]));
      expect(document.paths['/unrelated'].get.deprecated).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No OpenAPI path matches'));
    } finally {
      warn.mockRestore();
    }
  });

  it('warns and skips when the path exists but carries a different method', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      @Controller('orders')
      class OrdersController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        @Post()
        create() {
          return null;
        }
      }

      const document = documentWith('/orders');
      applyDeprecationDocs(document, stubApp([OrdersController]));
      expect(document.paths['/orders'].get.deprecated).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no operation for'));
    } finally {
      warn.mockRestore();
    }
  });

  it('skips non-routed helper methods on a class-level deprecated controller', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Controller('orders')
      class OrdersController {
        @Get()
        list() {
          return this.format([]);
        }

        // No request-method metadata: not a route, so nothing to document
        // and nothing to warn about.
        format(rows: unknown[]) {
          return rows;
        }
      }

      const document = documentWith('/orders');
      applyDeprecationDocs(document, stubApp([OrdersController]));
      expect(document.paths['/orders'].get.deprecated).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('marks every path of a route registered under several controller and method paths', () => {
    @Controller(['orders', 'purchases'])
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get(['', 'all'])
      list() {
        return null;
      }
    }

    const document = documentWith(
      '/orders',
      '/orders/all',
      '/purchases',
      '/purchases/all',
      '/unrelated',
    );
    applyDeprecationDocs(document, stubApp([OrdersController]));
    for (const path of ['/orders', '/orders/all', '/purchases', '/purchases/all']) {
      expect(document.paths[path].get.deprecated, path).toBe(true);
    }
    expect(document.paths['/unrelated'].get.deprecated).toBeUndefined();
  });

  it('never suffix-matches the root route against another path', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      @Controller()
      class RootController {
        @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
        @Get()
        index() {
          return null;
        }
      }

      // "/v1/" is the only path ending in "/", so a suffix match on "/" would
      // be unambiguous, and wrong.
      const document = documentWith('/v1/');
      applyDeprecationDocs(document, stubApp([RootController]));
      expect(document.paths['/v1/'].get.deprecated).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No OpenAPI path matches "/"'));
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves $ref responses alone and documents headers on the inline ones', () => {
    @Controller('orders')
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get()
      list() {
        return null;
      }
    }

    const shared = { $ref: '#/components/responses/NotFound' };
    const document = {
      paths: {
        '/orders': {
          get: {
            responses: {
              '200': { description: 'OK' } as Record<string, unknown>,
              '404': shared as Record<string, unknown>,
            },
          },
        },
      },
    };
    applyDeprecationDocs(document, stubApp([OrdersController]));
    const { responses } = document.paths['/orders'].get;
    expect(responses['200'].headers).toHaveProperty('Deprecation');
    expect(responses['404']).toEqual({ $ref: '#/components/responses/NotFound' });
  });

  it('uses the unscoped module path when the app cannot report its application id', () => {
    @Controller('orders')
    class OrdersController {
      @Deprecated({ deprecatedAt: '2026-07-01T00:00:00Z' })
      @Get()
      list() {
        return null;
      }
    }
    class AdminModule {}
    Reflect.defineMetadata(MODULE_PATH, 'admin', AdminModule);

    // No ModulesContainer, so there is no per-application key to look up.
    const app = {
      get: (token: unknown) => {
        if (token === DiscoveryService) {
          return {
            getControllers: () => [
              {
                metatype: OrdersController,
                name: 'OrdersController',
                host: { metatype: AdminModule },
              },
            ],
          };
        }
        if (token === ApplicationConfig) return { getGlobalPrefix: () => '' };
        throw new Error(`unexpected token ${String(token)}`);
      },
    } as unknown as INestApplication;

    // Both paths end in "/orders": only the module path makes the match exact.
    const document = documentWith('/admin/orders', '/public/orders');
    applyDeprecationDocs(document, app);
    expect(document.paths['/admin/orders'].get.deprecated).toBe(true);
    expect(document.paths['/public/orders'].get.deprecated).toBeUndefined();
  });

  it('ignores controllers with no metatype', () => {
    const app = {
      get: (token: unknown) => {
        if (token === DiscoveryService) {
          return { getControllers: () => [{ metatype: null, name: 'Bodiless' }] };
        }
        return { getGlobalPrefix: () => '' };
      },
    } as unknown as INestApplication;

    const document = documentWith('/orders');
    expect(() => applyDeprecationDocs(document, app)).not.toThrow();
    expect(document.paths['/orders'].get.deprecated).toBeUndefined();
  });
});
