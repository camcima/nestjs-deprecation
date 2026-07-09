import 'reflect-metadata';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { DeprecatedCallEvent, DeprecationModuleOptions } from '../../src/deprecation.interfaces';
import { DeprecationInterceptor } from '../../src/deprecation.interceptor';
import { Deprecated } from '../../src/deprecated.decorator';

class OrdersController {
  @Deprecated({
    deprecatedAt: '2026-07-01T00:00:00Z',
    sunsetAt: '2027-01-01T00:00:00Z',
    successor: '/v2/orders',
  })
  list() {
    return [];
  }

  fresh() {
    return [];
  }

  @Deprecated({ deprecatedAt: '2020-01-01T00:00:00Z', sunsetAt: '2020-06-01T00:00:00Z' })
  legacy() {
    return [];
  }
}

interface Harness {
  interceptor: DeprecationInterceptor;
  context: ExecutionContext;
  headers: Record<string, string>;
}

function createHarness(
  handler: (...args: never[]) => unknown,
  options: DeprecationModuleOptions = {},
  existingHeaders: Record<string, string> = {},
  contextType = 'http',
): Harness {
  const headers: Record<string, string> = { ...existingHeaders };
  const response = {
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
  };
  const request = { method: 'GET', route: { path: '/orders' } };
  const context = {
    getType: () => contextType,
    getHandler: () => handler,
    getClass: () => OrdersController,
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { interceptor: new DeprecationInterceptor(new Reflector(), options), context, headers };
}

const next: CallHandler = { handle: () => of('ok') };

describe('DeprecationInterceptor', () => {
  it('writes Deprecation, Sunset and Link headers for a deprecated handler', async () => {
    const { interceptor, context, headers } = createHarness(OrdersController.prototype.list);
    await firstValueFrom(interceptor.intercept(context, next));
    expect(headers).toEqual({
      Deprecation: '@1782864000',
      Sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
      Link: '</v2/orders>; rel="successor-version"',
    });
  });

  it('writes nothing for an undecorated handler', async () => {
    const { interceptor, context, headers } = createHarness(OrdersController.prototype.fresh);
    await firstValueFrom(interceptor.intercept(context, next));
    expect(headers).toEqual({});
  });

  it('writes headers even when the handler errors (headers set before handle())', async () => {
    const { interceptor, context, headers } = createHarness(OrdersController.prototype.list);
    const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    await expect(firstValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('boom');
    expect(headers.Deprecation).toBe('@1782864000');
  });

  it('appends to an existing Link header instead of overwriting', async () => {
    const { interceptor, context, headers } = createHarness(
      OrdersController.prototype.list,
      {},
      { Link: '</orders?page=2>; rel="next"' },
    );
    await firstValueFrom(interceptor.intercept(context, next));
    expect(headers.Link).toBe(
      '</orders?page=2>; rel="next", </v2/orders>; rel="successor-version"',
    );
  });

  it('does nothing when enabled is false', async () => {
    const { interceptor, context, headers } = createHarness(OrdersController.prototype.list, {
      enabled: false,
    });
    await firstValueFrom(interceptor.intercept(context, next));
    expect(headers).toEqual({});
  });

  it('ignores non-http contexts', async () => {
    const { interceptor, context, headers } = createHarness(
      OrdersController.prototype.list,
      {},
      {},
      'rpc',
    );
    await firstValueFrom(interceptor.intercept(context, next));
    expect(headers).toEqual({});
  });

  it('invokes onDeprecatedCall with the event', async () => {
    const events: DeprecatedCallEvent[] = [];
    const { interceptor, context } = createHarness(OrdersController.prototype.list, {
      onDeprecatedCall: (event) => events.push(event),
    });
    await firstValueFrom(interceptor.intercept(context, next));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'GET',
      route: '/orders',
      controllerName: 'OrdersController',
      handlerName: 'list',
      isPastSunset: false,
    });
    expect(events[0].metadata.deprecationHeader).toBe('@1782864000');
  });

  it('reports isPastSunset=true when the sunset date has passed', async () => {
    const events: DeprecatedCallEvent[] = [];
    const { interceptor, context } = createHarness(OrdersController.prototype.legacy, {
      onDeprecatedCall: (event) => events.push(event),
    });
    await firstValueFrom(interceptor.intercept(context, next));
    expect(events[0].isPastSunset).toBe(true);
  });

  it('swallows listener errors and still completes the request', async () => {
    const { interceptor, context, headers } = createHarness(OrdersController.prototype.list, {
      onDeprecatedCall: () => {
        throw new Error('listener boom');
      },
    });
    await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toBe('ok');
    expect(headers.Deprecation).toBe('@1782864000');
  });

  it('swallows header-write errors and still completes the request', async () => {
    const { interceptor, context } = createHarness(OrdersController.prototype.list);
    const broken = context.switchToHttp().getResponse() as { header: unknown };
    broken.header = () => {
      throw new Error('headers already sent');
    };
    await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toBe('ok');
  });

  it('contains rejected async listeners without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const capture = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', capture);
    try {
      const { interceptor, context, headers } = createHarness(OrdersController.prototype.list, {
        onDeprecatedCall: async () => {
          throw new Error('async listener boom');
        },
      });
      await expect(firstValueFrom(interceptor.intercept(context, next))).resolves.toBe('ok');
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(headers.Deprecation).toBe('@1782864000');
    } finally {
      process.off('unhandledRejection', capture);
    }
  });
});
