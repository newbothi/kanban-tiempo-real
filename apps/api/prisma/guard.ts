/**
 * S-18: los scripts que crean o borran datos (seed, simulación) no deben correr contra
 * producción por accidente. Se considera producción NODE_ENV=production o una base de
 * Azure SQL. Para hacerlo a propósito: ALLOW_PROD_SEED=1.
 */
export function assertSafeTarget(script: string) {
  const url = process.env.DATABASE_URL ?? '';
  const looksProd = process.env.NODE_ENV === 'production' || /database\.windows\.net/i.test(url);
  if (looksProd && process.env.ALLOW_PROD_SEED !== '1') {
    throw new Error(
      `${script}: la base parece de producción. Si de verdad quieres ejecutarlo ahí, define ALLOW_PROD_SEED=1.`,
    );
  }
}
