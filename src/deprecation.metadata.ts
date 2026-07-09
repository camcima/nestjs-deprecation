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
  for (const [index, custom] of (options.links ?? []).entries()) {
    if (typeof custom.rel !== 'string' || custom.rel.length === 0) {
      throw new Error(
        `[nestjs-deprecation] ${where}: "links[${index}].rel" must be a non-empty string.`,
      );
    }
    assertQuotedParamSafe(custom.rel, `links[${index}].rel`, where);
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

function parseDateOption(value: Date | string, option: string, where: string): Date {
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
  return date;
}

function assertHref(href: unknown, option: string, where: string): string {
  if (typeof href !== 'string') {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be a string, got: ${typeof href}`,
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
  // and < > " \ cannot appear raw in a URI-reference. Require pre-encoded input.
  if (/[\x00-\x20<>"\\]/.test(href)) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must not contain whitespace, control characters, or any of < > " \\ — percent-encode reserved characters instead`,
    );
  }
  return href;
}

/**
 * rel/type are emitted inside HTTP quoted-strings, where control characters,
 * double quotes and backslashes cannot appear raw (RFC 9110 §5.6.4).
 */
function assertQuotedParamSafe(value: unknown, option: string, where: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must be a string, got: ${typeof value}`,
    );
  }
  if (/[\x00-\x1F"\\]/.test(value)) {
    throw new Error(
      `[nestjs-deprecation] ${where}: "${option}" must not contain control characters, double quotes, or backslashes`,
    );
  }
}
