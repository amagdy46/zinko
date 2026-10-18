import { defineConfig } from 'vite-plus'

// Lint and format live here. Contributors and agents run `pnpm check`
// (format + lint + typecheck); `pnpm lint` / `pnpm format` run one step.
// The Effect rules need a patched install: `pnpm install` runs the
// `prepare` script for that. Unpatched oxlint rejects the config.
export default defineConfig({
  lint: {
    ignorePatterns: ['**/dist/**', '**/.turbo/**', '**/.wrangler/**', '**/routeTree.gen.ts'],
    categories: { correctness: 'error', suspicious: 'error', perf: 'error' },
    // an explicit list replaces oxlint's defaults, so keep oxc/typescript/unicorn
    plugins: ['oxc', 'typescript', 'unicorn', 'react', 'import', 'effecttsgo'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'typescript/no-explicit-any': 'error',
      'typescript/no-floating-promises': 'error',
      'no-unused-vars': 'error',
      'react/exhaustive-deps': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: 'error',
      'no-nested-ternary': 'error',
      // every tsconfig sets jsx: react-jsx, so React is never imported for JSX
      'react/react-in-jsx-scope': 'off',
      // exact pins make "unstable" Effect APIs safe; this flags it.effect itself
      'effecttsgo/unstable-api-usage': 'off',
    },
    overrides: [
      {
        // entry points are where layers get provided: the server runtime and one-off scripts
        files: ['apps/web/src/server/runtime.ts', 'packages/*/scripts/**'],
        rules: { 'effecttsgo/strict-effect-provide': 'off' },
      },
      {
        // seam file: add-ons re-export their services from here, so minimal stacks leave it empty
        files: ['packages/core/src/index.ts'],
        rules: { 'unicorn/no-empty-file': 'off' },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['**/dist/**', '**/.turbo/**', '**/.wrangler/**', '**/routeTree.gen.ts'],
    singleQuote: true,
    semi: false,
    printWidth: 100,
  },
})
