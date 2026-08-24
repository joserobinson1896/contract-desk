import { defineConfig } from 'vitest/config';
import path from 'node:path';

const here = import.meta.dirname;

/**
 * Test-runner scope — NOT app scope.
 *
 * This suite covers `src/domain` only: the billing engine and the flag rules.
 * Those are pure TypeScript with no React Native imports, so they run in plain
 * Node in milliseconds, which is what makes it practical to assert the contract
 * maths to the cent on every change.
 *
 * The UI in `src/app` and `src/components` is a full Expo Router app that renders
 * on web (`npm run web`) and on device via Expo Go (`npm start`). It simply is not
 * covered by THIS runner — screens are verified by running the app. Nothing here
 * limits what the app renders or where.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The UI layer is excluded on purpose — see above.
    exclude: ['node_modules/**', 'dist/**', '.expo/**'],
  },
});
