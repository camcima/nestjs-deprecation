import { metrics, type Attributes, type Counter, type MeterProvider } from '@opentelemetry/api';
import type { DeprecatedCallEvent, DeprecatedCallListener } from '../deprecation.interfaces';

export const DEPRECATED_REQUESTS_METRIC = 'http.server.deprecated_requests';

export interface OtelDeprecationListenerOptions {
  /** Explicit provider; defaults to the process-global meter registry. */
  meterProvider?: MeterProvider;
}

/**
 * Ready-made onDeprecatedCall listener that counts requests to deprecated
 * endpoints. Only calls @opentelemetry/api — never creates providers.
 *
 * The global meter provider is resolved per event rather than once at
 * creation. Unlike traces, the metrics API has no proxy provider: until the
 * SDK registers one, metrics.getMeterProvider() returns the permanent no-op.
 * Listeners are typically created inside a @Module() decorator, which runs
 * during module import — before a bootstrap()-initiated sdk.start(). Binding
 * eagerly there would silently drop every measurement.
 */
export function createOtelDeprecationListener(
  options: OtelDeprecationListenerOptions = {},
): DeprecatedCallListener {
  const explicitProvider = options.meterProvider;
  let boundProvider: MeterProvider | undefined;
  let counter: Counter | undefined;

  const resolveCounter = (): Counter => {
    const provider = explicitProvider ?? metrics.getMeterProvider();
    // Re-create only when the provider identity changes, so the steady-state
    // cost is one registry lookup and a reference comparison per request.
    if (counter === undefined || provider !== boundProvider) {
      boundProvider = provider;
      counter = provider
        .getMeter('@camcima/nestjs-deprecation')
        .createCounter(DEPRECATED_REQUESTS_METRIC, {
          description: 'Number of requests served by deprecated endpoints',
          unit: '{request}',
        });
    }
    return counter;
  };

  return (event: DeprecatedCallEvent) => {
    const attributes: Attributes = {
      'http.request.method': event.method,
      'http.route': event.route,
      'deprecation.past_sunset': event.isPastSunset,
    };
    if (event.metadata.sunsetAtIso !== undefined) {
      attributes['deprecation.sunset_date'] = event.metadata.sunsetAtIso;
    }
    resolveCounter().add(1, attributes);
  };
}
