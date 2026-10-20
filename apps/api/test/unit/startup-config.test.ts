import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJwtSecret } from '../../src/auth/secret';
import { checkStartupConfig, isKeyVaultReference, unresolvedKeyVaultReferences } from '../../src/startup';

afterEach(() => vi.unstubAllEnvs());

// Lo que App Service deja en la variable cuando no logra leer el secreto: texto público.
const REF = (name: string) => `@Microsoft.KeyVault(VaultName=kv-kanban-newbothi;SecretName=${name})`;
const TOKEN = 'm'.repeat(40);

describe('S-13: referencias de Key Vault sin resolver', () => {
  it('reconoce la referencia aunque cambien mayúsculas o haya espacios', () => {
    expect(isKeyVaultReference(REF('jwt-secret'))).toBe(true);
    expect(isKeyVaultReference('  @microsoft.keyvault(SecretUri=https://x.vault.azure.net/secrets/y)')).toBe(true);
    expect(isKeyVaultReference('Zk3q9f0l2PqR7sT1uV5wX8yA4bC6dE0gH2jK4mN6pQ8r')).toBe(false);
    expect(isKeyVaultReference(undefined)).toBe(false);
  });

  it('lista solo los nombres de las variables afectadas, ordenados', () => {
    const env = { ML_TOKEN: REF('ml-token'), JWT_SECRET: REF('jwt-secret'), NODE_ENV: 'production' };
    expect(unresolvedKeyVaultReferences(env)).toEqual(['JWT_SECRET', 'ML_TOKEN']);
  });

  it('la API no arranca si JWT_SECRET quedó como referencia (pese a medir más de 32)', () => {
    const env = { NODE_ENV: 'production', ML_TOKEN: TOKEN, JWT_SECRET: REF('jwt-secret') };
    expect(REF('jwt-secret').length).toBeGreaterThan(32);
    expect(() => checkStartupConfig(env)).toThrow(/Key Vault no resolvió: JWT_SECRET/);
  });

  it('tampoco arranca si la referencia sin resolver es ML_TOKEN o ACS', () => {
    expect(() => checkStartupConfig({ NODE_ENV: 'production', ML_TOKEN: REF('ml-token') })).toThrow(/ML_TOKEN/);
    expect(() =>
      checkStartupConfig({ NODE_ENV: 'production', ML_TOKEN: TOKEN, ACS_CONNECTION_STRING: REF('acs') }),
    ).toThrow(/ACS_CONNECTION_STRING/);
  });

  it('el mensaje de error no incluye el valor de ninguna variable', () => {
    const env = { NODE_ENV: 'production', ML_TOKEN: TOKEN, JWT_SECRET: REF('jwt-secret') };
    let message = '';
    try {
      checkStartupConfig(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('SecretName');
  });

  it('getJwtSecret rechaza la referencia también fuera de producción', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', REF('jwt-secret'));
    expect(() => getJwtSecret()).toThrow(/Key Vault/);
  });
});

describe('S-06: token del servicio ML', () => {
  it('en producción exige ML_TOKEN de al menos 32 caracteres', () => {
    expect(() => checkStartupConfig({ NODE_ENV: 'production' })).toThrow(/ML_TOKEN es obligatorio/);
    expect(() => checkStartupConfig({ NODE_ENV: 'production', ML_TOKEN: 'corto' })).toThrow(/ML_TOKEN/);
  });

  it('arranca con secretos ya resueltos', () => {
    expect(() => checkStartupConfig({ NODE_ENV: 'production', ML_TOKEN: TOKEN, JWT_SECRET: TOKEN })).not.toThrow();
  });

  it('en desarrollo no exige ML_TOKEN', () => {
    expect(() => checkStartupConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
});
