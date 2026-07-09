export interface LinkRelation {
  /** RFC 8288 link relation, e.g. "deprecation", "successor-version". */
  rel: string;
  /** Absolute URL or absolute path. */
  href: string;
  /** Optional media type hint, e.g. "text/html". */
  type?: string;
}

/** RFC 9651 structured-field Date: "@" + integer unix seconds (RFC 9745 §2). */
export function toDeprecationHeaderValue(date: Date): string {
  return `@${Math.trunc(date.getTime() / 1000)}`;
}

/** IMF-fixdate as required by RFC 8594. */
export function toSunsetHeaderValue(date: Date): string {
  return date.toUTCString();
}

/** RFC 8288 comma-separated link list. */
export function buildLinkHeaderValue(links: LinkRelation[]): string {
  return links
    .map(({ rel, href, type }) => `<${href}>; rel="${rel}"${type ? `; type="${type}"` : ''}`)
    .join(', ');
}
