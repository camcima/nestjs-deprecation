import 'reflect-metadata';
import { Controller, Get, INestApplication } from '@nestjs/common';
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
});
