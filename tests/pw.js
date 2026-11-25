// Load Playwright whether it's installed locally (npm i -D playwright) or
// globally (NODE_PATH), since ESM imports ignore NODE_PATH.
import { createRequire } from 'node:module';

let pw;
try {
  pw = await import('playwright');
} catch {
  pw = createRequire(import.meta.url)('playwright');
}
export const { chromium } = pw;
