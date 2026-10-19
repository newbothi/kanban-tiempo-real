// ESLint para todo el monorepo (API, paquete compartido y front).
// `npm run lint` en la raíz lo corre una vez para todos; el CI falla con cualquier error.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/src/generated/**', // cliente Prisma generado
      'packages/shared/src/ml-api.ts', // generado desde el OpenAPI de Python
      'apps/ml/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  // Base para todo el TypeScript
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_algo` marca a propósito un parámetro o variable sin usar.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // API y paquete compartido (Node)
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Front: reglas estrictas de typescript-eslint + reglas de hooks de React
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strict],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },

  // Tests y scripts: se permite console, aserciones no nulas y `any` para las
  // respuestas JSON que cada test revisa a mano.
  {
    files: ['**/test/**', '**/e2e/**', 'apps/api/prisma/**', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
