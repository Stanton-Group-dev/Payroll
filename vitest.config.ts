import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Pure-logic unit tests (node env). The `@/` alias mirrors tsconfig paths so
// modules under src that import via `@/...` resolve the same way they do in Next.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
