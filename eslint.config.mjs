import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
