import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/*.cjs',
      'eslint.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'playwright.config.ts',
            'vitest.integration.config.ts',
            'vitest.unit.config.ts',
            'tests/e2e/*.ts',
            'tests/integration/*.ts',
            'scripts/*.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks, sonarjs },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'sonarjs/no-exclusive-tests': 'error',
      'sonarjs/no-skipped-tests': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/generated/**'],
    rules: {
      complexity: ['error', 30],
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 650, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 5],
      'max-statements': ['error', 100],
      'no-warning-comments': [
        'error',
        { terms: ['TODO', 'FIXME', 'HACK', 'XXX'], location: 'anywhere' },
      ],
      'no-else-return': 'error',
      'sonarjs/cognitive-complexity': ['error', 25],
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-redundant-boolean': 'error',
    },
  },
  prettier,
);
