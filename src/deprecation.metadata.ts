import {
  buildLinkHeaderValue,
  LinkRelation,
  toDeprecationHeaderValue,
  toSunsetHeaderValue,
} from './header-values';
import { DeprecatedOptions, DeprecationMetadata } from './deprecation.interfaces';

/**
 * Validates DeprecatedOptions and precomputes the frozen wire values.
 * Throws at decoration time (i.e. app boot), never at request time.
 * `where` names the decorated target for error messages, e.g. "OrdersController.list".
 */
export function buildDeprecationMetadata(
  options: DeprecatedOptions,
  where: string,
): DeprecationMetadata {
  const deprecatedAt = parseDateOption(options.deprecatedAt, 'deprecatedAt', where);
  const sunsetAt =
    options.sunsetAt === undefined
      ? undefined
      : parseDateOption(options.sunsetAt, 'sunsetAt', where);

  if (sunsetAt && sunsetAt.getTime() < deprecatedAt.getTime()) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "sunsetAt" must not be earlier than "deprecatedAt" (RFC 9745).`,
    );
  }

  if (options.note !== undefined && typeof options.note !== 'string') {
    throw new Error(`[nestjs-deprecation] ${where}: "note" must be a string.`);
  }
  if (options.links !== undefined && !Array.isArray(options.links)) {
    throw new Error(`[nestjs-deprecation] ${where}: "links" must be an array.`);
  }

  const links: LinkRelation[] = [];
  if (options.link !== undefined) {
    links.push({ rel: 'deprecation', href: assertHref(options.link, 'link', where) });
  }
  if (options.successor !== undefined) {
    links.push({
      rel: 'successor-version',
      href: assertHref(options.successor, 'successor', where),
    });
  }
  const shorthandRels = new Set(links.map((link) => link.rel));
  for (const [index, custom] of (options.links ?? []).entries()) {
    if (typeof custom !== 'object' || custom === null) {
      throw new Error(`[nestjs-deprecation] ${where}: "links[${index}]" must be an object.`);
    }
    if (typeof custom.rel !== 'string' || custom.rel.length === 0) {
      throw new Error(
        `[nestjs-deprecation] ${where}: "links[${index}].rel" must be a non-empty string.`,
      );
    }
    assertQuotedParamSafe(custom.rel, `links[${index}].rel`, where);
    assertSingletonRel(custom.rel, links, shorthandRels, `links[${index}].rel`, where);
    if (custom.type !== undefined) {
      assertQuotedParamSafe(custom.type, `links[${index}].type`, where);
    }
    links.push({
      rel: custom.rel,
      href: assertHref(custom.href, `links[${index}].href`, where),
      type: custom.type,
    });
  }

  return Object.freeze({
    deprecationHeader: toDeprecationHeaderValue(deprecatedAt),
    sunsetHeader: sunsetAt ? toSunsetHeaderValue(sunsetAt) : undefined,
    linkHeader: links.length > 0 ? buildLinkHeaderValue(links) : undefined,
    deprecatedAtIso: deprecatedAt.toISOString(),
    sunsetAtIso: sunsetAt?.toISOString(),
    sunsetEpochMs: sunsetAt?.getTime(),
    note: options.note,
  });
}

/**
 * RFC 9745 allows at most one "deprecation" relation, and a single successor is
 * the only reading that makes "successor-version" actionable. Both have a
 * dedicated shorthand option, so a duplicate is always a configuration mistake.
 */
const SINGLETON_RELS = new Map([
  ['deprecation', 'link'],
  ['successor-version', 'successor'],
]);

function assertSingletonRel(
  rel: string,
  accumulated: LinkRelation[],
  shorthandRels: ReadonlySet<string>,
  option: string,
  where: string,
): void {
  const shorthandOption = SINGLETON_RELS.get(rel);
  if (shorthandOption === undefined) return;
  if (!accumulated.some((link) => link.rel === rel)) return;
  const source = shorthandRels.has(rel)
    ? `the "${shorthandOption}" option`
    : 'an earlier "links" entry';
  throw new Error(
    `[nestjs-deprecation] ${where}: "${option}" is redundant — only one "${rel}" link relation is allowed (RFC 9745), and it is already provided by ${source}.`,
  );
}

/**
 * The accepted string grammar: an RFC 3339 full-date, optionally followed by a
 * time and a UTC offset ("Z"/"z", "+hh:mm" or "+hhmm"). Anything else is left
 * to Date's implementation-defined fallback parser, which reads most forms in
 * the server's local timezone, so it is rejected instead.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/;

function parseDateOption(value: unknown, option: string, where: string): Date {
  if (!(value instanceof Date) && typeof value !== 'string') {
    const hint =
      typeof value === 'number'
        ? ' Unix timestamps are not accepted — pass new Date(seconds * 1000) instead.'
        : '';
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be a Date or an ISO 8601 string, got: ${
        value === null ? 'null' : typeof value
      }.${hint}`,
    );
  }
  if (typeof value === 'string') assertIsoDateString(value, option, where);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" is not a valid date: ${String(value)}`,
    );
  }
  if (date.getTime() < 0) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must not be before 1970-01-01 (structured-field dates are unix timestamps).`,
    );
  }
  // The emitted formats (RFC 9745 unix seconds, RFC 8594 IMF-fixdate) are
  // second-granular. Truncate once here so every derived value — headers,
  // ISO strings, sunsetEpochMs, isPastSunset — agrees exactly.
  return new Date(Math.trunc(date.getTime() / 1000) * 1000);
}

function assertIsoDateString(value: string, option: string, where: string): void {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be an ISO 8601 date (2026-07-01) or date-time with a timezone designator (2026-07-01T00:00:00Z), got: ${value}`,
    );
  }
  // A date-time without an offset is parsed in the server's local timezone, so
  // the emitted header would depend on where the app runs. Date-only strings
  // are unambiguous (UTC) and stay allowed.
  if (value.length > 10 && match[4] === undefined) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must include a timezone designator ("Z" or an offset such as "+02:00"), got: ${value}. Without one the value is interpreted in the server's local timezone.`,
    );
  }
  // Date() rolls impossible days over (2026-02-30 becomes March 2) rather
  // than failing, so check the calendar date as written.
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`[nestjs-deprecation] ${where}: "${option}" is not a valid date: ${value}`);
  }
}

function assertHref(href: unknown, option: string, where: string): string {
  if (typeof href !== 'string') {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be a string, got: ${typeof href}`,
    );
  }
  // "//host/path" is a network-path reference: it looks like an absolute path
  // but resolves to a different origin, so a stray slash silently retargets the
  // link. Require an explicit scheme instead.
  if (href.startsWith('//')) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be an absolute URL (with a scheme) or an absolute path; protocol-relative references such as ${href} are not allowed.`,
    );
  }
  if (!href.startsWith('/')) {
    try {
      new URL(href);
    } catch {
      throw new Error(
        `[nestjs-deprecation] ${where}: "${option}" must be a valid URL or absolute path, got: ${String(href)}`,
      );
    }
  }
  // RFC 8288 wraps the target in <...>, where whitespace, control characters
  // and < > " \ cannot appear raw in a URI-reference, and a URI-reference is
  // ASCII by definition. Non-ASCII would also fail at send time: Node rejects
  // it (a 500 under Fastify, which validates after the interceptor has run)
  // or mis-encodes Latin-1. Require pre-encoded input.
  if (/[^\x21-\x7E]|[<>"\\]/.test(href)) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must not contain whitespace, control characters, non-ASCII characters, or any of < > " \\ — percent-encode them instead`,
    );
  }
  return href;
}

/**
 * rel/type are emitted inside HTTP quoted-strings, where control characters,
 * double quotes and backslashes cannot appear raw (RFC 9110 §5.6.4). The
 * obs-text range that grammar still tolerates is rejected too: Node refuses
 * most of it and Fastify mis-encodes the rest.
 */
function assertQuotedParamSafe(value: unknown, option: string, where: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be a string, got: ${typeof value}`,
    );
  }
  if (/[^\x20-\x7E]|["\\]/.test(value)) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must not contain control characters, non-ASCII characters, double quotes, or backslashes`,
    );
  }
}
