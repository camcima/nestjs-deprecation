'use strict';
// Shared by consumer.cjs and consumer.mjs. Every module arrives as an argument
// so that each consumer exercises its own loading path (require() vs import)
// end to end: this file must never load Nest or the library itself.
const assert = require('node:assert/strict');

exports.runSmoke = async function runSmoke(modules, label) {
  const {
    Controller,
    Get,
    Module,
    NestFactory,
    DiscoveryModule,
    SwaggerModule,
    DocumentBuilder,
    Deprecated,
    DeprecationModule,
    applyDeprecationDocs,
    createOtelDeprecationListener,
  } = modules;
  assert.equal(typeof createOtelDeprecationListener, 'function', 'otel entry point');

  // Plain JavaScript has no decorator syntax: apply them the way tsc's
  // __decorate helper does.
  class OrdersController {
    list() {
      return [];
    }
  }
  Reflect.decorate(
    [
      Get(),
      Deprecated({ deprecatedAt: '2026-01-01', sunsetAt: '2027-01-01', successor: '/v2/orders' }),
    ],
    OrdersController.prototype,
    'list',
    Object.getOwnPropertyDescriptor(OrdersController.prototype, 'list'),
  );
  Reflect.decorate([Controller('orders')], OrdersController);

  const events = [];
  class AppModule {}
  Reflect.decorate(
    [
      Module({
        imports: [
          DeprecationModule.forRoot({ onDeprecatedCall: (event) => events.push(event) }),
          DiscoveryModule,
        ],
        controllers: [OrdersController],
      }),
    ],
    AppModule,
  );

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address();
    const response = await fetch(`http://127.0.0.1:${port}/orders`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('deprecation'), '@1767225600');
    assert.equal(response.headers.get('sunset'), 'Fri, 01 Jan 2027 00:00:00 GMT');
    assert.equal(response.headers.get('link'), '</v2/orders>; rel="successor-version"');
    assert.equal(events.length, 1, 'onDeprecatedCall fired once');
    assert.equal(events[0].route, '/orders');

    const document = applyDeprecationDocs(
      SwaggerModule.createDocument(app, new DocumentBuilder().build()),
      app,
    );
    const operation = document.paths['/orders'].get;
    assert.equal(operation.deprecated, true);
    assert.equal(operation['x-sunset'], '2027-01-01');
  } finally {
    await app.close();
  }
  console.log(`pack smoke OK (${label}, node ${process.version})`);
};
