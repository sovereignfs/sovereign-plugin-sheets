import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Same reasoning as the platform's root vitest.config.ts: this package's
  // tsconfig sets `jsx: preserve` (for Next), so Vite's oxc transformer must
  // be told to apply the automatic JSX transform for the .tsx component tests.
  oxc: { jsx: 'automatic' },
  test: {
    include: ['app/**/__tests__/**/*.test.{ts,tsx}'],
    // Default to node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file — the
    // same convention as the platform's root vitest.config.ts.
    environment: 'node',
    css: {
      // Resolve CSS Module class names to their literal names so component
      // tests can assert on them.
      modules: { classNameStrategy: 'non-scoped' },
    },
  },
});
