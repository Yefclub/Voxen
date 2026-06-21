import { describe, expect, it } from 'bun:test';
import { isLikelyNetscapeCookieFile } from '../src/lib/settings';

describe('isLikelyNetscapeCookieFile', () => {
  it('accepts content with the Netscape header', () => {
    expect(isLikelyNetscapeCookieFile('# Netscape HTTP Cookie File\nfoo bar')).toBe(true);
  });

  it('accepts content with the header case-insensitively', () => {
    expect(isLikelyNetscapeCookieFile('# netscape http cookie file\n')).toBe(true);
  });

  it('accepts a tab-separated cookie line without header', () => {
    expect(isLikelyNetscapeCookieFile('.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc')).toBe(
      true,
    );
  });

  it('rejects empty string', () => {
    expect(isLikelyNetscapeCookieFile('')).toBe(false);
  });

  it('rejects whitespace only', () => {
    expect(isLikelyNetscapeCookieFile('   \n  \n')).toBe(false);
  });

  it('rejects plain garbage without tabs or header', () => {
    expect(isLikelyNetscapeCookieFile('just some random text here')).toBe(false);
  });

  it('rejects JSON-looking content (no tabs)', () => {
    expect(isLikelyNetscapeCookieFile('{"sessionid":"abc","csrftoken":"def"}')).toBe(false);
  });

  it('ignores comment lines when checking for tabs', () => {
    expect(isLikelyNetscapeCookieFile('# a comment line\n# another one')).toBe(false);
  });
});
