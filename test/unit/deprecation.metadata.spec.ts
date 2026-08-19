import { buildDeprecationMetadata } from '../../src/deprecation.metadata';

const WHERE = 'OrdersController.list';

describe('buildDeprecationMetadata', () => {
  it('precomputes all wire values and freezes the result', () => {
    const metadata = buildDeprecationMetadata(
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        sunsetAt: '2027-01-01T00:00:00Z',
        link: 'https://docs.example.com/deprecations/orders-v1',
        successor: '/v2/orders',
        note: 'Use POST /v2/orders',
      },
      WHERE,
    );
    expect(metadata).toEqual({
      deprecationHeader: '@1782864000',
      sunsetHeader: 'Fri, 01 Jan 2027 00:00:00 GMT',
      linkHeader:
        '<https://docs.example.com/deprecations/orders-v1>; rel="deprecation", </v2/orders>; rel="successor-version"',
      deprecatedAtIso: '2026-07-01T00:00:00.000Z',
      sunsetAtIso: '2027-01-01T00:00:00.000Z',
      sunsetEpochMs: Date.parse('2027-01-01T00:00:00Z'),
      note: 'Use POST /v2/orders',
    });
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('accepts Date objects and omits optional fields when absent', () => {
    const metadata = buildDeprecationMetadata(
      { deprecatedAt: new Date('2026-07-01T00:00:00Z') },
      WHERE,
    );
    expect(metadata.deprecationHeader).toBe('@1782864000');
    expect(metadata.sunsetHeader).toBeUndefined();
    expect(metadata.linkHeader).toBeUndefined();
    expect(metadata.sunsetEpochMs).toBeUndefined();
  });

  it('appends custom links after the standard relations', () => {
    const metadata = buildDeprecationMetadata(
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        successor: '/v2/orders',
        links: [{ rel: 'latest-version', href: '/v3/orders', type: 'application/json' }],
      },
      WHERE,
    );
    expect(metadata.linkHeader).toBe(
      '</v2/orders>; rel="successor-version", </v3/orders>; rel="latest-version"; type="application/json"',
    );
  });

  it.each([
    [{ deprecatedAt: 'not-a-date' }, /"deprecatedAt".*not a valid date/],
    [{ deprecatedAt: '1969-12-31T00:00:00Z' }, /"deprecatedAt".*before 1970-01-01/],
    [
      { deprecatedAt: '2027-01-01T00:00:00Z', sunsetAt: '2026-07-01T00:00:00Z' },
      /"sunsetAt" must not be earlier than "deprecatedAt"/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', link: 'not a url' },
      /"link".*valid URL or absolute path/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: '', href: '/v2' }] },
      /"links\[0\]\.rel" must be a non-empty string/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'alternate', href: 'nope' }] },
      /"links\[0\]\.href".*valid URL or absolute path/,
    ],
    [
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        link: 'https://x.example/\r\nSet-Cookie: evil',
      },
      /control characters/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'bad\nrel', href: '/v2' }] },
      /control characters/,
    ],
    [
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        links: [{ rel: 'alternate', href: '/v2', type: 'a"b' }],
      },
      /double quotes/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', link: '/v2>; rel="alternate"' },
      /"link" must not contain whitespace, control characters/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', successor: '/v2 orders' },
      /"successor" must not contain whitespace/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', link: 'https://x.example/<v2>' },
      /"link" must not contain whitespace/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'alt\\ernate', href: '/v2' }] },
      /"links\[0\]\.rel" must not contain control characters, double quotes, or backslashes/,
    ],
    [{ deprecatedAt: '2026-07-01T00:00:00Z', note: 42 }, /"note" must be a string/],
    [{ deprecatedAt: '2026-07-01T00:00:00Z', links: 'nope' }, /"links" must be an array/],
    [{ deprecatedAt: '2026-07-01T00:00:00Z', links: [null] }, /"links\[0\]" must be an object/],
    [{ deprecatedAt: '2026-07-01T00:00:00Z', links: ['nope'] }, /"links\[0\]" must be an object/],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'alternate', href: '/v2', type: 7 }] },
      /"links\[0\]\.type" must be a string/,
    ],
    [{ deprecatedAt: '2026-07-01T00:00:00Z', link: 42 }, /"link" must be a string/],
    [{ deprecatedAt: null }, /"deprecatedAt" must be a Date or an ISO 8601 string/],
    [{ deprecatedAt: true }, /"deprecatedAt" must be a Date or an ISO 8601 string/],
    [{ deprecatedAt: 1782864000 }, /Unix timestamps are not accepted/],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', sunsetAt: 1798761600 },
      /Unix timestamps are not accepted/,
    ],
    [{ deprecatedAt: '2026-07-01T00:00:00' }, /"deprecatedAt" must include a timezone designator/],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', sunsetAt: '2027-01-01T12:30' },
      /"sunsetAt" must include a timezone designator/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', link: '//evil.example/docs' },
      /"link".*protocol-relative/,
    ],
    [
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'alternate', href: '//x.example' }] },
      /"links\[0\]\.href".*protocol-relative/,
    ],
    [
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        link: 'https://docs.example.com/d',
        links: [{ rel: 'deprecation', href: '/other' }],
      },
      /only one "deprecation" link relation/,
    ],
    [
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        successor: '/v2/orders',
        links: [{ rel: 'successor-version', href: '/v3/orders' }],
      },
      /only one "successor-version" link relation/,
    ],
    [
      {
        deprecatedAt: '2026-07-01T00:00:00Z',
        links: [
          { rel: 'deprecation', href: '/a' },
          { rel: 'deprecation', href: '/b' },
        ],
      },
      /only one "deprecation" link relation/,
    ],
  ])('rejects invalid options: %j', (options, message) => {
    expect(() => buildDeprecationMetadata(options as never, WHERE)).toThrow(message);
  });

  it('accepts date-only strings as UTC midnight', () => {
    const metadata = buildDeprecationMetadata({ deprecatedAt: '2026-07-01' }, WHERE);
    expect(metadata.deprecationHeader).toBe('@1782864000');
    expect(metadata.deprecatedAtIso).toBe('2026-07-01T00:00:00.000Z');
  });

  it('accepts an explicit UTC offset', () => {
    const metadata = buildDeprecationMetadata({ deprecatedAt: '2026-07-01T02:00:00+02:00' }, WHERE);
    expect(metadata.deprecatedAtIso).toBe('2026-07-01T00:00:00.000Z');
  });

  it('accepts a lone "deprecation" relation supplied through links', () => {
    const metadata = buildDeprecationMetadata(
      { deprecatedAt: '2026-07-01T00:00:00Z', links: [{ rel: 'deprecation', href: '/docs' }] },
      WHERE,
    );
    expect(metadata.linkHeader).toBe('</docs>; rel="deprecation"');
  });

  it('names the decorated target in error messages', () => {
    expect(() => buildDeprecationMetadata({ deprecatedAt: 'nope' }, WHERE)).toThrow(
      /OrdersController\.list/,
    );
  });

  it('truncates fractional seconds so headers, ISO values, and epoch agree', () => {
    const metadata = buildDeprecationMetadata(
      { deprecatedAt: '2026-07-01T00:00:00.900Z', sunsetAt: '2027-01-01T00:00:00.900Z' },
      WHERE,
    );
    expect(metadata.deprecationHeader).toBe('@1782864000');
    expect(metadata.deprecatedAtIso).toBe('2026-07-01T00:00:00.000Z');
    expect(metadata.sunsetHeader).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(metadata.sunsetAtIso).toBe('2027-01-01T00:00:00.000Z');
    expect(metadata.sunsetEpochMs).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
});
