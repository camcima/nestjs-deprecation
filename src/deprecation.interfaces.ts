import type { LinkRelation } from './header-values';

export type { LinkRelation };

export interface DeprecatedOptions {
  /** When the endpoint is (or will be) deprecated. Date or ISO 8601 string. Required. */
  deprecatedAt: Date | string;
  /** When the endpoint will stop working. Must not be earlier than deprecatedAt. */
  sunsetAt?: Date | string;
  /** Deprecation documentation URL — emitted as Link rel="deprecation" (RFC 9745). */
  link?: string;
  /** Replacement endpoint — emitted as Link rel="successor-version" (RFC 5829). */
  successor?: string;
  /** Escape hatch for arbitrary RFC 8288 relations, appended after link/successor. */
  links?: LinkRelation[];
  /** Human note; never sent on the wire. Surfaces in Swagger docs and telemetry. */
  note?: string;
}

/** Precomputed, frozen wire values stored as Reflect metadata at decoration time. */
export interface DeprecationMetadata {
  deprecationHeader: string;
  sunsetHeader?: string;
  linkHeader?: string;
  deprecatedAtIso: string;
  sunsetAtIso?: string;
  sunsetEpochMs?: number;
  note?: string;
}

export interface DeprecatedCallEvent {
  method: string;
  /** Route PATTERN (e.g. "/orders/:id"), not the concrete URL — keeps metric cardinality low. */
  route: string;
  controllerName: string;
  handlerName: string;
  metadata: DeprecationMetadata;
  isPastSunset: boolean;
}

export type DeprecatedCallListener = (event: DeprecatedCallEvent) => void;

export interface DeprecationModuleOptions {
  /** Kill switch. Default: true. */
  enabled?: boolean;
  /** Invoked on every request to a deprecated endpoint. Errors are caught and logged. */
  onDeprecatedCall?: DeprecatedCallListener;
}
