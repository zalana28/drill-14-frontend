'use strict';

// Shared test helpers: spawn the disposable notevault API + the UI server,
// wait until both answer, and stop them again.
//
// Ports: API 18081 (disposable DB), UI 18082 (proxies /api to the API).
// The browser binary is the cached Playwright headless shell; override
// with PLAYWRIGHT_CHROMIUM_PATH on another machine.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const API_PORT = 18081;
const UI_PORT = 18082;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const UI_URL = `http://127.0.0.1:${UI_PORT}`;
const DB_PATH = '/tmp/drill14-test-notevault.db';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';

async function waitReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 503) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not become ready: ${lastErr}`);
}

function spawnLogged(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function startApi() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* fresh DB */ }
  }
  const api = spawnLogged('node', ['src/server.js'], {
    cwd: path.join(process.env.HOME, 'workspace', 'notevault'),
    env: { ...process.env, PORT: String(API_PORT), DB_PATH },
  });
  await waitReady(`${API_URL}/health`);
  return api;
}

async function startUi() {
  const ui = spawnLogged('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, UI_PORT: String(UI_PORT), API_BASE: API_URL },
  });
  await waitReady(UI_URL);
  return ui;
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000).unref();
  });
}

module.exports = { API_PORT, UI_PORT, API_URL, UI_URL, DB_PATH, CHROMIUM_PATH, waitReady, startApi, startUi, stop };
