import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'lib/store.ts',
        'lib/types.ts',
        'app/api/stations/route.ts',
        'app/api/apartments/route.ts',
        'app/components/ApartmentCard.tsx',
        'app/components/FilterSidebar.tsx',
      ],
      exclude: ['**/*.test.*', '**/__tests__/**', 'node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
