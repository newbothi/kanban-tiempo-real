const isProduction = () => process.env.NODE_ENV === 'production';

/** Valores de ejemplo publicados en el repositorio: nunca deben usarse en producción (S-13). */
const EXAMPLE_SECRETS = new Set([
  'reemplaza-esto-por-un-secreto-aleatorio-de-al-menos-32-caracteres',
  'secreto-solo-para-tests-con-mas-de-32-caracteres',
  'secreto-de-ci-con-mas-de-32-caracteres-xxxx',
]);

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Falta JWT_SECRET en apps/api/.env (mínimo 32 caracteres). Revisa .env.example.');
  }
  if (isProduction() && EXAMPLE_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET es un valor de ejemplo público: con él cualquiera puede falsificar sesiones. ' +
        'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return secret;
}
