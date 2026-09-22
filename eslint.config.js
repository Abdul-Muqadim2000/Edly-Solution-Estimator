import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'legacy', 'data'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      /* `const { _bundleId: _a, ...rest } = x` is how fields are dropped — the binding is the point. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  }
);
