import { describe, expect, it } from 'vitest';
import { boardRoom, evenKeys, MAX_POSITION_LENGTH, userRoom } from '../src';

describe('rooms de Socket.IO', () => {
  it('el room de un tablero y el de un usuario no pueden chocar', () => {
    const id = '7f0c2a4e-1111-4222-8333-944455556666';
    expect(boardRoom(id)).toBe(`board:${id}`);
    expect(userRoom(id)).toBe(`user:${id}`);
    expect(boardRoom(id)).not.toBe(userRoom(id));
  });
});

describe('evenKeys', () => {
  it('genera claves ordenadas, únicas y cortas', () => {
    const keys = evenKeys(500);
    expect(keys).toHaveLength(500);
    expect(new Set(keys).size).toBe(500);
    expect([...keys].sort()).toEqual(keys);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(MAX_POSITION_LENGTH);
  });
});
