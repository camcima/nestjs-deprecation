import { metrics, type Attributes, type MeterProvider } from '@opentelemetry/api';
import type { DeprecatedCallEvent, DeprecatedCallListener } from '../deprecation.interfaces';

export const DEPRECATED_REQUESTS_METRIC = 'http.server.deprecated_requests';

export interface OtelDeprecationListenerOptions {
  /** Explicit provider; defaults to the process-global meter registry. */
  meterProvider?: MeterProvider;
}

/**
 * Ready-made onDeprecatedCall listener that counts requests to deprecated
 * endpoints. Only calls @opentelemetry/api — never creates providers.
 */
export function createOtelDeprecationListener(
  options: OtelDeprecationListenerOptions = {},
): DeprecatedCallListener {
  const provider = options.meterProvider ?? metrics.getMeterProvider();
  const meter = provider.getMeter('@camcima/nestjs-deprecation');
  const counter = meter.createCounter(DEPRECATED_REQUESTS_METRIC, {
    description: 'Number of requests served by deprecated endpoints',
    unit: '{request}',
  });

  return (event: DeprecatedCallEvent) => {
    const attributes: Attributes = {
      'http.request.method': event.method,
      'http.route': event.route,
      'deprecation.past_sunset': event.isPastSunset,
    };
    if (event.metadata.sunsetAtIso !== undefined) {
      attributes['deprecation.sunset_date'] = event.metadata.sunsetAtIso;
    }
    counter.add(1, attributes);
  };
}
