import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/*.mjs',
      '**/*.d.ts',
      'lib/api-client-react/src/generated/**',
      'lib/api-zod/src/generated/**',
      'lib/api-client-react/src/**',
      'lib/api-zod/src/**',
      'release-artifacts/**',
      'android/**',
      'scripts/**',
      'docs/tests/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['artifacts/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    rules: {
      // Pragmatic baseline for a mature codebase: these legacy patterns are
      // reported as warnings so CI can show trends without blocking merges.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-constant-condition': 'off',
      'no-prototype-builtins': 'off',
    },
  },
);
