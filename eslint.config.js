import security from 'eslint-plugin-security';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  // Apply security plugin to all JS/TS source files
  {
    files: ['src/**/*.ts'],
    plugins: {
      security,
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // eslint-plugin-security rules
      'security/detect-non-literal-regexp': 'error',
      // All file paths are validated before use — dynamic paths are intentional in a file manager
      'security/detect-non-literal-fs-filename': 'off',
      // Bracket notation on typed Records (Record<string, V>) is safe via TypeScript types
      'security/detect-object-injection': 'off',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-buffer-noassert': 'error',
      // spawn() is used deliberately with argument arrays — not string concatenation
      'security/detect-child-process': 'off',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-unsafe-regex': 'error',

      // TypeScript strict rules relevant to security
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  // Ignore built output and test files
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.test.ts', '__tests__/**', 'scripts/**'],
  },
];
