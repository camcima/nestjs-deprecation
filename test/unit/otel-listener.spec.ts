import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { DeprecatedCallEvent } from '../../src/deprecation.interfaces';
import {
  createOtelDeprecationListener,
  DEPRECATED_REQUESTS_METRIC,
} from '../../src/otel/create-otel-deprecation-listener';

function makeEvent(overrides: Partial<DeprecatedCallEvent> = {}): DeprecatedCallEvent {
  return {
    method: 'GET',
    route: '/orders/:id',
    controllerName: 'OrdersController',
    handlerName: 'byId',
    isPastSunset: false,
    metadata: {
      deprecationHeader: '@1782864000',
      deprecatedAtIso: '2026-07-01T00:00:00.000Z',
      sunsetAtIso: '2027-01-01T00:00:00.000Z',
      sunsetHeader: 'Fri, 01 Jan 2027 00:00:00 GMT',
      sunsetEpochMs: Date.parse('2027-01-01T00:00:00Z'),
    },
    ...overrides,
  };
}

describe('createOtelDeprecationListener', () => {
  it('increments the counter with low-cardinality attributes', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3600_000 });
    const meterProvider = new MeterProvider({ readers: [reader] });

    const listener = createOtelDeprecationListener({ meterProvider });
    listener(makeEvent());
    listener(makeEvent({ isPastSunset: true }));

    await reader.forceFlush();
    const [resourceMetrics] = exporter.getMetrics();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === DEPRECATED_REQUESTS_METRIC);

    expect(metric).toBeDefined();
    expect(metric!.dataPoints).toHaveLength(2);
    const attributeSets = metric!.dataPoints.map((p) => p.attributes);
    expect(attributeSets).toContainEqual({
      'http.request.method': 'GET',
      'http.route': '/orders/:id',
      'deprecation.past_sunset': false,
      'deprecation.sunset_date': '2027-01-01T00:00:00.000Z',
    });
    expect(attributeSets).toContainEqual(
      expect.objectContaining({ 'deprecation.past_sunset': true }),
    );
    await meterProvider.shutdown();
  });

  it('omits the sunset_date attribute when no sunset is set', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3600_000 });
    const meterProvider = new MeterProvider({ readers: [reader] });

    const listener = createOtelDeprecationListener({ meterProvider });
    listener(
      makeEvent({
        metadata: { deprecationHeader: '@1782864000', deprecatedAtIso: '2026-07-01T00:00:00.000Z' },
      }),
    );

    await reader.forceFlush();
    const [resourceMetrics] = exporter.getMetrics();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === DEPRECATED_REQUESTS_METRIC);
    expect(metric!.dataPoints[0].attributes).not.toHaveProperty('deprecation.sunset_date');
    await meterProvider.shutdown();
  });
});
