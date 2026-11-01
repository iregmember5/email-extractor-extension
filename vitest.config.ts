import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'website-companion/src/**/*.test.ts'] },
});
