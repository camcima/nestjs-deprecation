import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DeprecationModule } from '../../src';
import { applyDeprecationDocs, ApplyDeprecationDocsOptions } from '../../src/swagger';
import { AssetsController, createAppModule } from './app.fixture';

describe('applyDeprecationDocs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [createAppModule({}, [], [AssetsController])],
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

  /**
   * The example of the documented `Sunset` response header, or undefined when
   * the operation does not document one. Asserts every response agrees: the
   * header is described on all of them or on none, never a subset.
   */
  function sunsetHeaderExample(operation: unknown): string | undefined {
    const { responses } = operation as {
      responses: Record<string, { headers?: Record<string, { schema: { example: string } }> }>;
    };
    const examples = Object.values(responses).map((r) => r.headers?.Sunset?.schema.example);
    expect(examples.length).toBeGreaterThan(0);
    expect(new Set(examples).size).toBe(1);
    return examples[0];
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

  it('stamps x-sunset and documents the Sunset header together', () => {
    const document = buildDocument();
    const operation = document.paths['/orders'].get as unknown as Record<string, unknown>;
    // The extension and the response header are two views of one sunset date:
    // the RFC 3339 full-date diff tools read, and the RFC 8594 HTTP-date
    // clients receive. When there is a sunset, both are present.
    expect(operation['x-sunset']).toBe('2027-01-01');
    expect(sunsetHeaderExample(operation)).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    const classLevel = document.paths['/legacy'].get as unknown as Record<string, unknown>;
    expect(classLevel['x-sunset']).toBe('2027-01-01');
    expect(sunsetHeaderExample(classLevel)).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
  });

  it('omits both x-sunset and the Sunset header when there is no sunset date', () => {
    const document = buildDocument();
    const operation = document.paths['/orders/{id}'].get as unknown as Record<string, unknown>;
    expect(operation.deprecated).toBe(true);
    expect(operation).not.toHaveProperty('x-sunset');
    expect(sunsetHeaderExample(operation)).toBeUndefined();
  });

  it('still documents the Sunset header when x-sunset is opted out', () => {
    const document = buildDocument({ xSunset: false });
    const operation = document.paths['/orders'].get as unknown as Record<string, unknown>;
    expect(operation.deprecated).toBe(true);
    // xSunset only suppresses the extension. The endpoint still sends the
    // Sunset header at runtime, so the document must keep describing it.
    expect(operation).not.toHaveProperty('x-sunset');
    expect(sunsetHeaderExample(operation)).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
  });

  it('does not clobber an x-sunset the user authored themselves', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('fixture').build(),
    );
    const operation = document.paths['/orders'].get as unknown as Record<string, unknown>;
    operation['x-sunset'] = '2030-06-30';

    applyDeprecationDocs(document, app);

    expect(operation['x-sunset']).toBe('2030-06-30');
    // The header example keeps describing what the endpoint actually sends,
    // which is the decorator's date — a hand-authored extension overrides only
    // the extension, so the two can legitimately disagree here.
    expect(sunsetHeaderExample(operation)).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
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

  it('marks handlers inherited from a base controller class', () => {
    const document = buildDocument();
    expect(document.paths['/reports/summary'].get?.deprecated).toBe(true);
    expect(document.paths['/reports/fresh'].get?.deprecated).toBeUndefined();
  });

  it('marks operations for non-CRUD request methods such as SEARCH', () => {
    const document = buildDocument();
    // SEARCH is a valid Nest route method that @nestjs/swagger emits, but it
    // is not part of the OpenAPI PathItemObject type.
    const pathItem = document.paths['/assets/find'] as unknown as Record<
      string,
      { deprecated?: boolean } | undefined
    >;
    expect(pathItem.search?.deprecated).toBe(true);
  });

  it('does not clobber a response header the user documented in another case', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('fixture').build(),
    );
    const operation = document.paths['/orders'].get as {
      responses: Record<string, { headers?: Record<string, unknown> }>;
    };
    const [firstResponse] = Object.values(operation.responses);
    firstResponse.headers = { link: { description: 'pagination links' } };

    applyDeprecationDocs(document, app);

    const headerNames = Object.keys(firstResponse.headers ?? {});
    expect(headerNames.filter((name) => name.toLowerCase() === 'link')).toEqual(['link']);
    expect(firstResponse.headers?.link).toEqual({ description: 'pagination links' });
  });

  it('resolves paths behind a global prefix even when another path shares the suffix', async () => {
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
