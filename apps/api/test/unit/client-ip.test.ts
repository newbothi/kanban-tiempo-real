import { describe, expect, it } from 'vitest';
import { clientIp } from '../../src/http';

describe('clientIp (S-02)', () => {
  it('quita el puerto que agrega Azure a una IPv4', () => {
    expect(clientIp({ ip: '203.0.113.5:54321' })).toBe('203.0.113.5');
  });

  it('quita el puerto y los corchetes de una IPv6', () => {
    expect(clientIp({ ip: '[2001:db8::1]:443' })).toBe('2001:db8::1');
  });

  it('deja intactas las IPs sin puerto', () => {
    expect(clientIp({ ip: '203.0.113.5' })).toBe('203.0.113.5');
    expect(clientIp({ ip: '::1' })).toBe('::1');
    expect(clientIp({ ip: '::ffff:127.0.0.1' })).toBe('::ffff:127.0.0.1');
  });
});
