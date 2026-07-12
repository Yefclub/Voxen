import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { presignEnabled, s3PublicEndpoint } from '../src/lib/s3';

describe('s3 public endpoint helpers', () => {
  const original = process.env.S3_PUBLIC_ENDPOINT;

  beforeEach(() => {
    delete process.env.S3_PUBLIC_ENDPOINT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.S3_PUBLIC_ENDPOINT;
    else process.env.S3_PUBLIC_ENDPOINT = original;
  });

  test('presign desabilitado quando S3_PUBLIC_ENDPOINT ausente', () => {
    expect(s3PublicEndpoint()).toBeUndefined();
    expect(presignEnabled()).toBe(false);
  });

  test('presign habilitado quando S3_PUBLIC_ENDPOINT definido', () => {
    process.env.S3_PUBLIC_ENDPOINT = 'https://s3.example.com';
    expect(s3PublicEndpoint()).toBe('https://s3.example.com');
    expect(presignEnabled()).toBe(true);
  });

  test('string vazia conta como ausente (presign desabilitado)', () => {
    process.env.S3_PUBLIC_ENDPOINT = '';
    expect(presignEnabled()).toBe(false);
  });
});
