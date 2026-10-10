import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Playwright E2E는 별도 브라우저 runner가 실행한다.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
