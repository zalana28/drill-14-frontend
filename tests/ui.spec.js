'use strict';

// Playwright UI tests for notevault-ui (node:test + playwright-core).
// The tests run against a disposable notevault API (fresh DB per run) and
// the UI server that proxies /api to it. No test touches the scored
// drill-7/8 repo's live.db.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { API_URL, UI_URL, CHROMIUM_PATH, startApi, startUi, stop, waitReady } = require('./helpers');

let browser;
let api;
let ui;

before(async () => {
  api = await startApi();
  ui = await startUi();
  browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
});

after(async () => {
  if (browser) await browser.close();
  await stop(ui);
  await stop(api);
});

describe('notevault-ui', () => {
  it('CRUD flow: create -> list -> edit inline -> delete with confirm', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(UI_URL);
      await page.getByText('No notes yet.').waitFor();

      await page.locator('#title-input').fill('First note');
      await page.locator('#body-input').fill('Hello world');
      await page.locator('#create-button').click();
      await page.locator('li.note h3', { hasText: 'First note' }).waitFor();
      assert.equal(await page.locator('#status').textContent(), 'Note "First note" created.');

      // Edit inline.
      await page.locator('li.note button', { hasText: 'Edit' }).click();
      const editTitle = page.locator('.edit-form input');
      await editTitle.fill('First note (edited)');
      await page.locator('.edit-form textarea').fill('Hello edited world');
      await page.locator('.edit-form button[type="submit"]').click();
      await page.locator('li.note h3', { hasText: 'First note (edited)' }).waitFor();
      assert.match(await page.locator('li.note .note-body').textContent(), /Hello edited world/);
      assert.equal(await page.locator('#status').textContent(), 'Note "First note (edited)" updated.');

      // Delete with confirm.
      await page.locator('li.note button', { hasText: 'Delete' }).click();
      await page.locator('#delete-dialog').waitFor();
      await page.locator('#delete-confirm').click();
      await page.getByText('No notes yet.').waitFor();
      assert.equal(await page.locator('#status').textContent(), 'Note "First note (edited)" deleted.');
    } finally {
      await page.close();
    }
  });

  it('validation errors show per field and create nothing', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(UI_URL);
      await page.getByText('No notes yet.').waitFor();

      // Empty title.
      await page.locator('#create-button').click();
      await page.locator('#title-error').waitFor();
      assert.equal(await page.locator('#title-error').textContent(), 'title is required');
      assert.equal(await page.locator('li.note').count(), 0);

      // 201-char title.
      await page.locator('#title-input').fill('x'.repeat(201));
      await page.locator('#create-button').click();
      assert.equal(
        await page.locator('#title-error').textContent(),
        'title must be at most 200 characters',
      );
      assert.equal(await page.locator('li.note').count(), 0);
    } finally {
      await page.close();
    }
  });

  it('keyboard-only: Tab through the form, Enter submits, Esc cancels edit', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(UI_URL);
      await page.getByText('No notes yet.').waitFor();

      // Tab from the top lands on the title input (first focusable element).
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'title-input');
      await page.keyboard.type('Keyboard note');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'body-input');
      await page.keyboard.type('typed without a mouse');
      await page.keyboard.press('Tab'); // -> Save note button
      assert.equal(await page.evaluate(() => document.activeElement.id), 'create-button');
      await page.keyboard.press('Enter');
      await page.locator('li.note h3', { hasText: 'Keyboard note' }).waitFor();

      // Tab from the title input to the note's Edit button, Enter opens it.
      await page.keyboard.press('Tab'); // body
      await page.keyboard.press('Tab'); // Save note
      await page.keyboard.press('Tab'); // Edit
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        'Edit',
      );
      await page.keyboard.press('Enter');
      await page.locator('.edit-form input').waitFor();
      await page.keyboard.press('Escape');
      // Edit cancelled: the original note is back, unchanged.
      await page.locator('li.note h3', { hasText: 'Keyboard note' }).waitFor();
      assert.equal(await page.locator('.edit-form').count(), 0);

      // Clean up so later tests start from a known list.
      await page.locator('li.note button', { hasText: 'Delete' }).click();
      await page.locator('#delete-confirm').click();
      await page.getByText('No notes yet.').waitFor();
    } finally {
      await page.close();
    }
  });

  it('aria-live: status announces create and delete; error region is role=alert', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(UI_URL);
      assert.equal(await page.locator('#status').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#list-error').getAttribute('role'), 'alert');

      await page.locator('#title-input').fill('Announce me');
      await page.locator('#create-button').click();
      await page.locator('li.note h3', { hasText: 'Announce me' }).waitFor();
      assert.match(await page.locator('#status').textContent(), /created/);

      await page.locator('li.note button', { hasText: 'Delete' }).click();
      await page.locator('#delete-confirm').click();
      await page.getByText('No notes yet.').waitFor();
      assert.match(await page.locator('#status').textContent(), /deleted/);
    } finally {
      await page.close();
    }
  });

  it('XSS: malicious title/body render as literal text, no element, no alert', async () => {
    const page = await browser.newPage();
    let alertFired = false;
    page.on('dialog', () => { alertFired = true; });
    try {
      await page.goto(UI_URL);
      const evilTitle = '<img src=x onerror=alert(1)>';
      const evilBody = '<script>alert(2)</script>';
      await page.locator('#title-input').fill(evilTitle);
      await page.locator('#body-input').fill(evilBody);
      await page.locator('#create-button').click();
      const note = page.locator('li.note', { hasText: evilTitle });
      await note.waitFor();
      assert.equal(await note.locator('h3').textContent(), evilTitle);
      assert.equal(await note.locator('.note-body').textContent(), evilBody);
      assert.equal(await note.locator('img').count(), 0);
      assert.equal(await note.locator('script').count(), 0);
      assert.equal(alertFired, false);

      // Clean up.
      await note.locator('button', { hasText: 'Delete' }).click();
      await page.locator('#delete-confirm').click();
      await page.getByText('No notes yet.').waitFor();
    } finally {
      await page.close();
    }
  });

  it('mobile 360px: no horizontal scroll, form usable', async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto(UI_URL);
      await page.getByText('No notes yet.').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `horizontal overflow at 360px: ${overflow}px`);

      await page.locator('#title-input').fill('Mobile note');
      await page.locator('#create-button').click();
      await page.locator('li.note h3', { hasText: 'Mobile note' }).waitFor();
      const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflowAfter <= 0, `horizontal overflow at 360px after create: ${overflowAfter}px`);

      // Clean up.
      await page.locator('li.note button', { hasText: 'Delete' }).click();
      await page.locator('#delete-confirm').click();
      await page.getByText('No notes yet.').waitFor();
    } finally {
      await page.close();
      await context.close();
    }
  });

  it('API down: UI shows an error state, does not crash', async () => {
    const page = await browser.newPage();
    try {
      // Stop the API, then reload: the list must show an error, not a
      // blank page or a crash.
      await stop(api);
      api = null;
      await page.goto(UI_URL);
      await page.locator('#list-error').waitFor();
      assert.match(await page.locator('#list-error-text').textContent(), /Could not reach the server/);
      assert.equal(await page.locator('h1').textContent(), 'notevault');

      // Creating while the API is down shows a form error, not a hang.
      await page.locator('#title-input').fill('Will not save');
      await page.locator('#create-button').click();
      await page.locator('#form-error').waitFor();
      assert.match(await page.locator('#form-error').textContent(), /Could not reach the server/);
    } finally {
      await page.close();
      // Restart the API so teardown is clean.
      api = await startApi();
      await waitReady(`${API_URL}/health`);
    }
  });
});
