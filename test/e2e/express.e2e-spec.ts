import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DeprecatedCallEvent } from '../../src';
import { createAppModule, linkSettingProvider } from './app.fixture';

describe('Express e2e', () => {
  let app: INestApplication;
  const events: DeprecatedCallEvent[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        createAppModule({ onDeprecatedCall: (e) => events.push(e) }, [linkSettingProvider]),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it('emits all three headers on a deprecated endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/orders').expect(200);
    expect(res.headers['deprecation']).toBe('@1782864000');
    expect(res.headers['sunset']).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(res.headers['link']).toContain(
      '<https://docs.example.com/deprecations/orders-v1>; rel="deprecation"',
    );
    expect(res.headers['link']).toContain('</v2/orders>; rel="successor-version"');
  });

  it('appends to a pre-existing Link header', async () => {
    const res = await request(app.getHttpServer()).get('/orders').expect(200);
    expect(res.headers['link']).toContain('</orders?page=2>; rel="next"');
    expect(res.headers['link']).toContain('rel="deprecation"');
  });

  it('emits no headers on an undecorated endpoint', async () => {
    const res = await request(app.getHttpServer()).get('/orders/fresh').expect(200);
    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.headers['sunset']).toBeUndefined();
  });

  it('emits headers even when the handler throws', async () => {
    const res = await request(app.getHttpServer()).get('/orders/failing').expect(500);
    expect(res.headers['deprecation']).toBe('@1577836800');
    expect(res.headers['sunset']).toBe('Mon, 01 Jun 2020 00:00:00 GMT');
  });

  it('emits headers on streaming responses', async () => {
    const res = await request(app.getHttpServer()).get('/orders/stream').expect(200);
    expect(res.headers['deprecation']).toBe('@1782864000');
    // StreamableFile defaults to Content-Type: application/octet-stream, so
    // superagent buffers the body as binary (res.body: Buffer) rather than
    // parsing it as text (res.text), unlike the Fastify inject() response.
    expect((res.body as Buffer).toString()).toBe('chunk-1chunk-2');
  });

  it('applies class-level deprecation to all handlers', async () => {
    const res = await request(app.getHttpServer()).get('/legacy').expect(200);
    expect(res.headers['deprecation']).toBe('@1782864000');
  });

  it('reports the route pattern, not the URL, in the hook event', async () => {
    await request(app.getHttpServer()).get('/orders/42').expect(200);
    const event = events.find((e) => e.handlerName === 'byId');
    expect(event?.route).toBe('/orders/:id');
    expect(event?.method).toBe('GET');
    expect(event?.controllerName).toBe('OrdersController');
  });

  it('emits nothing when the kill switch is off', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createAppModule({ enabled: false })],
    }).compile();
    const disabledApp = moduleRef.createNestApplication();
    await disabledApp.init();
    const res = await request(disabledApp.getHttpServer()).get('/orders').expect(200);
    expect(res.headers['deprecation']).toBeUndefined();
    await disabledApp.close();
  });
});
