/**
 * Comprobaciones de configuración antes de arrancar: si algo falta, la API NO arranca
 * (falla cerrado) y el motivo queda en el log del despliegue.
 */

// Si App Service no logra leer un secreto de Key Vault (permiso, nombre o red), NO deja la
// variable vacía: pasa el texto de la referencia tal cual. Ese texto es público (está en el
// README) y mide más de 32 caracteres, así que pasaría el control de longitud: con
// JWT_SECRET = "@Microsoft.KeyVault(...)" cualquiera podría firmar sesiones válidas.
const KEY_VAULT_REFERENCE = /^\s*@Microsoft\.KeyVault\(/i;

export function isKeyVaultReference(value: string | undefined): boolean {
  return value !== undefined && KEY_VAULT_REFERENCE.test(value);
}

/** Nombres (nunca valores) de las variables que quedaron como referencia sin resolver. */
export function unresolvedKeyVaultReferences(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((name) => isKeyVaultReference(env[name]))
    .sort();
}

export function checkStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const unresolved = unresolvedKeyVaultReferences(env);
  if (unresolved.length > 0) {
    throw new Error(
      `Key Vault no resolvió: ${unresolved.join(', ')}. Revisa el permiso de la identidad de la app ` +
        'sobre el secreto y "az webapp config appsettings" (S-13).',
    );
  }
  // En producción, el servicio ML exige un token: sin él, las métricas fallarían siempre (S-06).
  if (env.NODE_ENV === 'production' && (env.ML_TOKEN ?? '').length < 32) {
    throw new Error('ML_TOKEN es obligatorio en producción (mínimo 32 caracteres, el mismo del servicio ML)');
  }
}
