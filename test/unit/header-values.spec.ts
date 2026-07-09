import {
  buildLinkHeaderValue,
  toDeprecationHeaderValue,
  toSunsetHeaderValue,
} from '../../src/header-values';

describe('toDeprecationHeaderValue', () => {
  it('formats as an RFC 9651 structured-field date (unix seconds)', () => {
    // Example straight from RFC 9745: 2023-06-30T23:59:59Z
    expect(toDeprecationHeaderValue(new Date('2023-06-30T23:59:59Z'))).toBe('@1688169599');
  });

  it('truncates sub-second precision', () => {
    expect(toDeprecationHeaderValue(new Date('2023-06-30T23:59:59.900Z'))).toBe('@1688169599');
  });
});

describe('toSunsetHeaderValue', () => {
  it('formats as IMF-fixdate', () => {
    expect(toSunsetHeaderValue(new Date('2027-01-01T00:00:00Z'))).toBe(
      'Fri, 01 Jan 2027 00:00:00 GMT',
    );
  });
});

describe('buildLinkHeaderValue', () => {
  it('formats a single relation', () => {
    expect(buildLinkHeaderValue([{ rel: 'deprecation', href: 'https://docs.example.com/d' }])).toBe(
      '<https://docs.example.com/d>; rel="deprecation"',
    );
  });

  it('joins multiple relations with a comma and includes type when set', () => {
    expect(
      buildLinkHeaderValue([
        { rel: 'deprecation', href: 'https://docs.example.com/d', type: 'text/html' },
        { rel: 'successor-version', href: '/v2/orders' },
      ]),
    ).toBe(
      '<https://docs.example.com/d>; rel="deprecation"; type="text/html", </v2/orders>; rel="successor-version"',
    );
  });
});
