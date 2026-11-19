# Drill #14 — notevault-ui: design (written before code)

## Goal
A zero-build frontend for the notevault API (drill-7 repo, branch
red-team/drill-8, latest code incl. F5). Vanilla ES modules + CSS, served
statically from this sandbox. The scored notevault code is NOT modified.

## Pre-flight (explicit)
- Env: sandbox Linux, Node v24.22.1, npm 10.9.4.
- API source of truth read first: ~/workspace/notevault/src/app.js +
  src/db.js (branch red-team/drill-8). Endpoints: GET /health, POST /notes,
  GET /notes, GET /notes/:id, PUT /notes/:id, DELETE /notes/:id. Note shape:
  {id, title, body, created_at, updated_at}; list ORDER BY id ASC.
  Validation (app.js validateNote): title required (trim, non-empty),
  title <= 200 chars (trimmed), body optional string, body <= 10000 chars.
  Errors: {error: CODE, message: string} — a SINGLE message, not a
  per-field object. 400 VALIDATION, 404 NOT_FOUND, 503 DB_UNAVAILABLE.
  No CORS headers on the API.
- Ports 18080-18089 verified free (ss). Plan: API on 18081 with a
  disposable DB_PATH (/tmp/drill14-notevault.db); UI server on 18082.
- Playwright: `playwright` + `playwright-core` installed at
  ~/.dev-browser/node_modules; browsers cached at
  ~/.cache/ms-playwright (chromium-1248, chromium_headless_shell-1248).
  Tests use playwright-core (local devDependency) + the cached headless
  shell via executablePath (env PLAYWRIGHT_CHROMIUM_PATH overrides).
- First demo must be valid: dev-time iterations happen before the official
  demo/test run that gets reported.

## Architecture
- public/index.html — semantic HTML: header, main, create form
  (label+input title, label+textarea body), notes list (ul), status region
  (aria-live polite), error region (role=alert), native <dialog> for
  delete confirmation (focus trap + Esc are free).
- public/app.js — vanilla ES module. State machine per async operation:
  list (loading / empty / error / loaded), create (idle / submitting /
  success / error), edit inline (idle / saving / error), delete (confirm /
  deleting / error). All user data rendered via textContent / createElement.
  NO innerHTML anywhere in app.js (grep-enforced: the string does not
  appear in the file).
- public/styles.css — responsive single column, max-width 720px, 16px
  padding, inputs width 100%, box-sizing border-box, long words break.
  Focus visible: :focus-visible 3px outline. Input font-size 16px
  (prevents mobile zoom). Palette (contrast, white background):
  text #1f2937 (14.68:1), muted #4b5563 (7.56:1), primary button #1d4ed8
  with white text (6.70:1), danger button #b91c1c with white text (6.47:1),
  border #6b7280 (4.83:1). All text contrast >= 4.5:1 (ratios computed
  with a WCAG luminance script, see README).
- server.js — zero-dep Node http server. Serves public/ statically and
  proxies /api/* to http://127.0.0.1:18081 (the notevault API). The proxy
  exists because the API sets no CORS headers and the scored repo must
  not be modified. The frontend fetches relative /api/notes — same origin,
  no CORS, no credentials anywhere.
- The API itself runs separately from ~/workspace/notevault with
  PORT=18081 and a disposable DB_PATH. The UI never touches the scored
  repo's live.db.

## Validation mirroring (exact rules from app.js)
Client-side, before any fetch, with the backend's own wording:
- title empty (after trim) -> "title is required" (title field)
- title > 200 chars (after trim) -> "title must be at most 200 characters"
- body > 10000 chars -> "body must be at most 10000 characters"
Backend 400s are routed to the matching field: message containing "title"
-> title field; "body" -> body field; anything else -> form-level error.
Client validation is a mirror, not a replacement: the backend still
enforces everything, and its 400 is what the UI shows when it fires.

## Accessibility
- <label for> on every input; form has aria-labelledby; list is a <ul>
  with one <li> per note; headings in order (h1, then h2 for the list).
- aria-live="polite" #status announces create/update/delete results;
  role="alert" for errors (assertive by default).
- Keyboard-only: every action is a real <button> (Tab + Enter/Space);
  Esc cancels an inline edit (keydown handler) and closes the delete
  dialog (native); after edit-cancel focus returns to the Edit button;
  after delete focus moves to the create form's title input.
- Focus visible everywhere via :focus-visible; nothing is
  tabindex-managed by hand (no positive tabindex).

## Responsive
- Fluid single column; at 360px: no horizontal scroll (test asserts
  documentElement.scrollWidth <= 360); note cards stack; buttons wrap;
  inputs are 100% wide. At 1280px the column is capped at 720px centered.

## Threat model
1. XSS via note content (the main risk: titles/bodies are attacker-
   controlled text). Mitigation: textContent only, no innerHTML with user
   data, no eval, no inline handlers. Proven by a test that stores
   "<img src=x onerror=alert(1)>" as a title and asserts it renders as
   literal text with no img element and no alert.
2. API error leakage: backend messages are generic codes
   (VALIDATION / NOT_FOUND / DB_UNAVAILABLE); no stack traces are ever
   sent, so displaying the message is safe.
3. Secrets: none in the frontend; no credentials, no tokens, no API keys.
   The proxy adds no auth headers.
4. CSRF / auth: the API has no auth (drill #7 scope) and the UI runs on
   localhost against a disposable DB — documented, not a finding.
5. Delete accidents: delete always requires the confirm dialog; Esc or
   Cancel aborts; nothing is deleted on a single click.

## Tests (Playwright + node:test, >= 6)
1. CRUD flow: create via form -> appears in list; edit inline -> title
   and body updated; delete with confirm -> gone from list.
2. Validation error shown: empty title -> per-field error under title,
   no note created; 201-char title -> error shown, no note created.
3. Keyboard-only: Tab to the form, type, Enter submits; Tab to Edit,
   Enter opens the editor, Esc cancels it (note unchanged).
4. aria-live: after create, #status text announces the result; after
   delete, it announces the deletion.
5. Mobile 360px: no horizontal scroll; form usable; list visible.
6. API down: API server stopped -> reload -> UI shows an error state
   (role=alert), does not crash; create while down shows an error.
7. XSS escape: malicious title renders as literal text, no element
   created, no alert fired.

## Layout
- DESIGN.md (this file), README.md, SPEC note in README
- public/index.html, public/app.js, public/styles.css
- server.js (static + /api proxy), package.json (playwright-core devDep)
- tests/ui.spec.js (node:test + playwright-core), scripts/screenshot.js
- screenshots/ (chat evidence only, NOT pushed to the repo)
