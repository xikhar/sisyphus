import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

export function launchBrowser() {
  // Prefer Playwright's matching browser; retain the local Linux fallback.
  const executablePath = process.env.CHROMIUM_PATH ||
    (!existsSync(chromium.executablePath()) && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  return chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
}
