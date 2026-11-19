# Drill #14 — notevault-ui: zero-build frontend for the notevault API

Vanilla ES modules + CSS, no build step, no framework. Serves statically
and proxies `/api/*` to the notevault API (drill-7 repo, branch
red-team/drill-8, latest code incl. F5). The scored notevault code is NOT
modified.

## Run it

```sh
# 1. Start the API (disposable DB, from the notevault repo):
PORT=18081 DB_PATH=/tmp/drill14-notevault.db node src/server.js
# 2. Start the UI (from this repo):
npm start            # serves on http://127.0.0.1:18082
# 3. Tests:
npm test             # node:test + playwright-core, 7 tests
npm run screenshots  # screenshots/notevault-1280.png + notevault-360.png
```

## Results (fresh run, 2026-11-19)

`npm test` → 7 tests, 0 fail (duration ~4s). The first run already passed
7/7; the only change after it was a comment rewording in app.js (the word
"innerHTML" appeared inside a comment, which made the grep claim false),
followed by a second clean 7/7 run that is the reported one.

1. CRUD flow: create -> list -> edit inline -> delete with confirm.
2. Validation errors show per field and create nothing (empty title,
   201-char title).
3. Keyboard-only: Tab through the form, Enter submits, Esc cancels edit.
4. aria-live: status announces create/delete; error region is role=alert.
5. XSS: malicious title/body render as literal text, no element, no alert.
6. Mobile 360px: no horizontal scroll, form usable.
7. API down: UI shows an error state, does not crash.

## Design (see DESIGN.md for the full pre-flight + threat model)

- `public/index.html` — semantic HTML, labels on every input, native
  `<dialog>` for delete confirmation (focus trap + Esc are free).
- `public/app.js` — vanilla ES module. State machine per async operation
  (loading / empty / error / loaded for the list; submitting / success /
  error for create/edit/delete). User data is rendered ONLY via
  textContent / createElement. Zero `innerHTML` hits in the whole repo
  (grep-verified).
- `public/styles.css` — single fluid column (max-width 720px), inputs
  100% wide, `:focus-visible` 3px outline, 16px input font (no mobile
  zoom), long words break so 360px never scrolls horizontally.
- `server.js` — zero-dep Node http server: static files + `/api/*`
  reverse proxy to the notevault API. The proxy exists because the API
  sets no CORS headers and the scored repo must not be modified.
- Validation mirrors the backend exactly (same rules, same wording):
  title required, title <= 200 chars, body <= 10000 chars. The backend
  returns ONE message string on a 400; the UI routes it to the field it
  names (title / body / form-level).

## Contrast (WCAG, computed with a luminance script, white background)

- body text #1f2937: 14.68:1
- muted text #4b5563: 7.56:1
- white text on primary #1d4ed8: 6.70:1
- white text on danger #b91c1c: 6.47:1
- border #6b7280: 4.83:1

All text contrast >= 4.5:1.

## Screenshots

`screenshots/` holds the 1280px and 360px captures (chat evidence). They
are NOT pushed to the repo (binary blobs in a source snapshot).

## Test setup

Playwright runs on the cached headless shell
(~/.cache/ms-playwright/chromium_headless_shell-1248/...); override with
the PLAYWRIGHT_CHROMIUM_PATH env var on another machine. The tests spawn
their own disposable API (fresh DB per run, /tmp/drill14-test-notevault.db)
and UI server, then stop both. API ports: 18081 (API), 18082 (UI).
