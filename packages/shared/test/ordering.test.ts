import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import { byPosition, keyAtEnd, keyAtIndex, sortByPosition } from '../src/ordering';

describe('byPosition', () => {
  it('ordena byte a byte: mayúsculas antes que minúsculas', () => {
    // Con localeCompare "a" < "Z"; en orden binario "Z" (0x5A) < "a" (0x61).
    const items = [{ position: 'a0' }, { position: 'Zz' }, { position: 'a0V' }];
    expect(sortByPosition(items).map((i) => i.position)).toEqual(['Zz', 'a0', 'a0V']);
  });

  it('no muta el arreglo original', () => {
    const items = [{ position: 'b' }, { position: 'a' }];
    sortByPosition(items);
    expect(items[0].position).toBe('b');
  });

  it('devuelve 0 para claves iguales', () => {
    expect(byPosition({ position: 'a1' }, { position: 'a1' })).toBe(0);
  });
});

describe('keyAtEnd / keyAtIndex', () => {
  const list = generateNKeysBetween(null, null, 3).map((position) => ({ position }));

  it('keyAtEnd queda después de todas', () => {
    const k = keyAtEnd(list);
    expect(list.every((i) => i.position < k)).toBe(true);
  });

  it('keyAtEnd en lista vacía genera una clave válida', () => {
    expect(keyAtEnd([])).toBeTypeOf('string');
  });

  it('keyAtIndex(0) queda antes de la primera', () => {
    expect(keyAtIndex(list, 0) < list[0].position).toBe(true);
  });

  it('keyAtIndex en medio queda entre sus vecinos', () => {
    const k = keyAtIndex(list, 1);
    expect(list[0].position < k && k < list[1].position).toBe(true);
  });

  it('índices fuera de rango se acotan', () => {
    expect(keyAtIndex(list, 99) > list[2].position).toBe(true);
    expect(keyAtIndex(list, -5) < list[0].position).toBe(true);
  });

  it('insertar 200 veces en el mismo hueco mantiene el orden', () => {
    // Caso típico de "arrastrar siempre al mismo lugar": las claves crecen pero nunca chocan.
    let items = [...list];
    for (let n = 0; n < 200; n++) {
      items = [...items, { position: keyAtIndex(sortByPosition(items), 1) }];
    }
    const sorted = sortByPosition(items).map((i) => i.position);
    expect(new Set(sorted).size).toBe(sorted.length);
  });
});
