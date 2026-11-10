import next from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import typescript from 'typescript-eslint';

export default defineConfig(
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx,mts,cts}'],
    rules: {
      'no-constant-binary-expression': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [typescript.configs.recommended],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [next.flatConfig.coreWebVitals],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
