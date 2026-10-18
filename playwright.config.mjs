import { defineConfig } from '@playwright/test';
import { chromePath } from './dist/audit.js';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 45000,
  reporter: [['list'], ['json', { outputFile: '.local/validation/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:4311', launchOptions: { executablePath: chromePath() }, screenshot: 'only-on-failure' },
  webServer: { command: 'node --env-file-if-exists=.env dist/server.js', url: 'http://127.0.0.1:4311', env: { PORT: '4311', MODEL_REQUEST_LIMIT: '0' }, reuseExistingServer: false },
});
