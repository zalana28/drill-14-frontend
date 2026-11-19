'use strict';

// Capture the 1280px and 360px screenshots for the drill report.
// Seeds two notes via the API first, so both viewports show real content.
// The screenshots live in screenshots/ (chat evidence, NOT pushed to git).

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { API_URL, UI_URL, CHROMIUM_PATH, startApi, startUi, stop } = require('../tests/helpers');

async function main() {
  const api = await startApi();
  const ui = await startUi();
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  try {
    for (const note of [
      { title: 'Buy oat milk', body: 'Oat, not almond. Two cartons.' },
      { title: 'Read the drill brief', body: 'Frontend craft: zero-build, accessible, responsive.' },
    ]) {
      const res = await fetch(`${API_URL}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      if (!res.ok) throw new Error(`seed failed: ${res.status}`);
    }

    const outDir = path.join(__dirname, '..', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await desktop.goto(UI_URL);
    await desktop.locator('li.note h3', { hasText: 'Buy oat milk' }).waitFor();
    await desktop.screenshot({ path: path.join(outDir, 'notevault-1280.png') });
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await mobile.goto(UI_URL);
    await mobile.locator('li.note h3', { hasText: 'Buy oat milk' }).waitFor();
    await mobile.screenshot({ path: path.join(outDir, 'notevault-360.png') });
    await mobile.close();

    console.log('screenshots written:', fs.readdirSync(outDir).join(', '));
  } finally {
    await browser.close();
    await stop(ui);
    await stop(api);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
