import { defineConfig } from '@playwright/test';

// 本环境无 root 权限，Chromium 系统依赖解压到了用户目录，需要注入 LD_LIBRARY_PATH
const localLibs = [
  '/home/node/pw-libs/root/usr/lib/aarch64-linux-gnu',
  '/home/node/pw-libs/root/lib/aarch64-linux-gnu',
];
process.env.LD_LIBRARY_PATH = [...localLibs, process.env.LD_LIBRARY_PATH]
  .filter(Boolean)
  .join(':');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
