import 'reflect-metadata';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DeprecatedCallEvent } from '../../src';
import { createAppModule, linkSettingProvider } from './app.fixture';

describe('Fastify e2e', () => {
  let app: NestFastifyApplication;
  const events: DeprecatedCallEvent[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        createAppModule({ onDeprecatedCall: (e) => events.push(e) }, [linkSettingProvider]),
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it('emits all three headers on a deprecated endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['deprecation']).toBe('@1782864000');
    expect(res.headers['sunset']).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(String(res.headers['link'])).toContain('rel="deprecation"');
    expect(String(res.headers['link'])).toContain('</v2/orders>; rel="successor-version"');
  });

  it('appends to a pre-existing Link header', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders' });
    expect(String(res.headers['link'])).toContain('</orders?page=2>; rel="next"');
    expect(String(res.headers['link'])).toContain('rel="deprecation"');
  });

  it('emits no headers on an undecorated endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders/fresh' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['deprecation']).toBeUndefined();
  });

  it('emits headers even when the handler throws', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders/failing' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['deprecation']).toBe('@1577836800');
  });

  it('emits headers on streaming responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders/stream' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['deprecation']).toBe('@1782864000');
    expect(res.body).toBe('chunk-1chunk-2');
  });

  it('applies class-level deprecation to all handlers', async () => {
    const res = await app.inject({ method: 'GET', url: '/legacy' });
    expect(res.headers['deprecation']).toBe('@1782864000');
  });

  it('reports the route pattern, not the URL, in the hook event', async () => {
    await app.inject({ method: 'GET', url: '/orders/42' });
    const event = events.find((e) => e.handlerName === 'byId');
    expect(event?.route).toBe('/orders/:id');
  });
});
