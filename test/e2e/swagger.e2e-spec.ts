import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DeprecationModule } from '../../src';
import { applyDeprecationDocs } from '../../src/swagger';
import { createAppModule } from './app.fixture';

describe('applyDeprecationDocs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createAppModule()],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function buildDocument() {
    applyDeprecationDocs(app);
    return SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('fixture').build());
  }

  it('marks deprecated operations and leaves fresh ones untouched', () => {
    const document = buildDocument();
    expect(document.paths['/orders'].get?.deprecated).toBe(true);
    expect(document.paths['/orders/fresh'].get?.deprecated).toBeUndefined();
  });

  it('marks operations on class-decorated controllers', () => {
    const document = buildDocument();
    expect(document.paths['/legacy'].get?.deprecated).toBe(true);
  });

  it('appends a human-readable deprecation block to the description', () => {
    const document = buildDocument();
    const description = document.paths['/orders'].get?.description ?? '';
    expect(description).toContain('**Deprecated** since 2026-07-01');
    expect(description).toContain('**Sunset**: 2027-01-01');
    expect(description).toContain('Use POST /v2/orders');
  });

  it('documents the response headers with example values', () => {
    const document = buildDocument();
    const responses = document.paths['/orders'].get?.responses as Record<string, any>;
    const headers = responses['default'].headers;
    expect(headers.Deprecation.schema.example).toBe('@1782864000');
    expect(headers.Sunset.schema.example).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(headers.Link.schema.example).toContain('rel="deprecation"');
  });

  it('merges with a user-authored @ApiOperation instead of clobbering it', () => {
    const document = buildDocument();
    const operation = document.paths['/orders/documented'].get;
    expect(operation?.summary).toBe('Documented list');
    expect(operation?.description).toContain('User-authored description.');
    expect(operation?.description).toContain('**Deprecated** since 2026-07-01');
  });

  it('is idempotent: repeated calls do not duplicate the deprecation block', () => {
    buildDocument();
    const document = buildDocument();
    const description = document.paths['/orders/documented'].get?.description ?? '';
    const count = (description.match(/\*\*Deprecated\*\* since/g) || []).length;
    expect(count).toBe(1);
  });

  it('respects the filter option', () => {
    const seen: Array<string | undefined> = [];
    applyDeprecationDocs(app, {
      filter: (c) => {
        seen.push(c.name);
        return false;
      },
    });
    expect(seen).toContain('OrdersController');
    expect(seen).toContain('LegacyController');
  });

  it('throws a clear error when DiscoveryModule is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot()],
    }).compile();
    const bareApp = moduleRef.createNestApplication();
    await bareApp.init();
    expect(() => applyDeprecationDocs(bareApp)).toThrow(/requires DiscoveryModule/);
    await bareApp.close();
  });
});
