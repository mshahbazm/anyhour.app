import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3190',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'bun run --cwd ../api test/fixtures/workspaceBrowserServer.ts',
      url: 'http://localhost:3191/api/health',
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: 'VITE_API_URL=http://localhost:3191 bun run dev --port 3190',
      url: 'http://localhost:3190',
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
})
