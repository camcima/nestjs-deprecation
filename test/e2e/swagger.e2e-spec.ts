import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DeprecationModule } from '../../src';
import { applyDeprecationDocs, ApplyDeprecationDocsOptions } from '../../src/swagger';
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

  function buildDocument(options?: ApplyDeprecationDocsOptions) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('fixture').build(),
    );
    return applyDeprecationDocs(document, app, options);
  }

  it('marks deprecated operations and leaves fresh ones untouched', () => {
    const document = buildDocument();
    expect(document.paths['/orders'].get?.deprecated).toBe(true);
    expect(document.paths['/orders/{id}'].get?.deprecated).toBe(true);
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

  it('documents the response headers on every response of the operation', () => {
    const document = buildDocument();
    const responses = document.paths['/orders'].get?.responses as Record<
      string,
      { headers?: Record<string, { schema: { example: string } }> }
    >;
    expect(Object.keys(responses).length).toBeGreaterThan(0);
    for (const response of Object.values(responses)) {
      expect(response.headers?.Deprecation.schema.example).toBe('@1782864000');
      expect(response.headers?.Sunset.schema.example).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
      expect(response.headers?.Link.schema.example).toContain('rel="deprecation"');
    }
  });

  it('merges with a user-authored @ApiOperation instead of clobbering it', () => {
    const document = buildDocument();
    const operation = document.paths['/orders/documented'].get;
    expect(operation?.summary).toBe('Documented list');
    expect(operation?.description).toContain('User-authored description.');
    expect(operation?.description).toContain('**Deprecated** since 2026-07-01');
  });

  it('is idempotent when applied twice to the same document', () => {
    const document = buildDocument();
    applyDeprecationDocs(document, app);
    const description = document.paths['/orders/documented'].get?.description ?? '';
    expect(description.match(/\*\*Deprecated\*\* since/g)).toHaveLength(1);
  });

  it('applies the filter per document: excluded controllers stay untouched', () => {
    const internalDoc = buildDocument();
    const publicDoc = buildDocument({ filter: (c) => c.name !== 'OrdersController' });
    expect(internalDoc.paths['/orders'].get?.deprecated).toBe(true);
    expect(publicDoc.paths['/orders'].get?.deprecated).toBeUndefined();
    expect(publicDoc.paths['/orders'].get?.description ?? '').not.toContain('**Deprecated**');
    expect(publicDoc.paths['/legacy'].get?.deprecated).toBe(true);
  });

  it('resolves paths behind a global prefix via unique suffix match', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createAppModule()],
    }).compile();
    const prefixed = moduleRef.createNestApplication();
    prefixed.setGlobalPrefix('api');
    await prefixed.init();
    try {
      const document = SwaggerModule.createDocument(
        prefixed,
        new DocumentBuilder().setTitle('prefixed').build(),
      );
      applyDeprecationDocs(document, prefixed);
      expect(document.paths['/api/orders'].get?.deprecated).toBe(true);
    } finally {
      await prefixed.close();
    }
  });

  it('throws a clear error when DiscoveryModule is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot()],
    }).compile();
    const bareApp = moduleRef.createNestApplication();
    await bareApp.init();
    try {
      expect(() => applyDeprecationDocs({ paths: {} }, bareApp)).toThrow(
        /requires DiscoveryModule/,
      );
    } finally {
      await bareApp.close();
    }
  });
});
