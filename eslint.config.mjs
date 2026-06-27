import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/wasm/**",
    "src/lib/wasm/pkg/**",
  ]),
  // Allow _ prefixed identifiers to be intentionally unused
  {
    // Pin the React version so eslint-plugin-react's auto-detect path (which
    // crashes on ESLint 10's flat-config context API) is skipped entirely.
    settings: { react: { version: '19.2' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
]);

export default eslintConfig;
