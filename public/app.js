'use strict';

// notevault-ui: vanilla ES module. No framework, no build step.
// Security rule: user data is rendered ONLY via textContent / createElement.
// This file never writes raw HTML built from user data. That is the XSS defence.

const $ = (sel, root = document) => root.querySelector(sel);

const createForm = $('#create-form');
const titleInput = $('#title-input');
const bodyInput = $('#body-input');
const titleError = $('#title-error');
const bodyError = $('#body-error');
const formError = $('#form-error');
const createButton = $('#create-button');
const notesList = $('#notes-list');
const listStatus = $('#list-status');
const listError = $('#list-error');
const listErrorText = $('#list-error-text');
const retryButton = $('#retry-button');
const emptyState = $('#empty-state');
const statusRegion = $('#status');
const deleteDialog = $('#delete-dialog');
const deleteDialogText = $('#delete-dialog-text');
const deleteError = $('#delete-error');
const deleteCancel = $('#delete-cancel');
const deleteConfirm = $('#delete-confirm');

let pendingDeleteId = null;
let pendingDeleteTitle = '';
let focusAfterLoadId = null;

// ---------------------------------------------------------------- API ---

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check that it is running and try again.');
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message = (data && data.message) || `Request failed (${res.status}).`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------- validation ------
// Mirrors the backend rules in notevault src/app.js validateNote, with the
// backend's own wording, so the client and the server reject the same input.

function validateTitle(title) {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'title is required';
  if (trimmed.length > 200) return 'title must be at most 200 characters';
  return null;
}

function validateBody(body) {
  if (body.length > 10000) return 'body must be at most 10000 characters';
  return null;
}

// The backend returns ONE message string on a 400. Route it to the field
// it names; anything else goes to the form-level error.
function routeBackendError(message, setTitle, setBody, setForm) {
  const lower = message.toLowerCase();
  if (lower.includes('title')) setTitle(message);
  else if (lower.includes('body')) setBody(message);
  else setForm(message);
}

// ------------------------------------------------------------- status ----

function announce(message) {
  statusRegion.textContent = '';
  statusRegion.textContent = message;
}

function showFieldError(input, el, message) {
  el.textContent = message || '';
  el.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function showFormError(el, message) {
  el.textContent = message || '';
  el.hidden = !message;
}

// -------------------------------------------------------------- list -----

function noteElement(note) {
  const li = document.createElement('li');
  li.className = 'note';
  li.dataset.id = String(note.id);

  const title = document.createElement('h3');
  title.textContent = note.title;
  li.appendChild(title);

  if (note.body) {
    const body = document.createElement('p');
    body.className = 'note-body';
    body.textContent = note.body;
    li.appendChild(body);
  }

  const meta = document.createElement('p');
  meta.className = 'note-meta';
  meta.textContent = `Created ${new Date(note.created_at).toLocaleString()}`;
  li.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'note-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'secondary';
  editBtn.textContent = 'Edit';
  editBtn.dataset.action = 'edit';
  editBtn.addEventListener('click', () => startEdit(li, note));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.addEventListener('click', () => openDeleteDialog(note));
  actions.appendChild(deleteBtn);

  li.appendChild(actions);
  return li;
}

async function loadNotes() {
  listStatus.textContent = 'Loading notes…';
  listError.hidden = true;
  emptyState.hidden = true;
  notesList.replaceChildren();

  let notes;
  try {
    notes = await api('/notes');
  } catch (err) {
    listStatus.textContent = '';
    listErrorText.textContent = err.message;
    listError.hidden = false;
    return;
  }

  listError.hidden = true;
  if (notes.length === 0) {
    listStatus.textContent = 'No notes.';
    emptyState.hidden = false;
    return;
  }
  listStatus.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}.`;
  for (const note of notes) notesList.appendChild(noteElement(note));

  if (focusAfterLoadId !== null) {
    const id = focusAfterLoadId;
    focusAfterLoadId = null;
    const btn = notesList.querySelector(`li[data-id="${id}"] button[data-action="edit"]`);
    if (btn) btn.focus();
  }
}

// ------------------------------------------------------------ create -----

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldError(titleInput, titleError, null);
  showFieldError(bodyInput, bodyError, null);
  showFormError(formError, null);

  const titleErr = validateTitle(titleInput.value);
  const bodyErr = validateBody(bodyInput.value);
  if (titleErr) showFieldError(titleInput, titleError, titleErr);
  if (bodyErr) showFieldError(bodyInput, bodyError, bodyErr);
  if (titleErr || bodyErr) {
    if (titleErr) titleInput.focus();
    return;
  }

  createButton.disabled = true;
  createButton.textContent = 'Saving…';
  try {
    const note = await api('/notes', {
      method: 'POST',
      body: { title: titleInput.value.trim(), body: bodyInput.value },
    });
    createForm.reset();
    announce(`Note "${note.title}" created.`);
    await loadNotes();
    titleInput.focus();
  } catch (err) {
    routeBackendError(
      err.message,
      (m) => showFieldError(titleInput, titleError, m),
      (m) => showFieldError(bodyInput, bodyError, m),
      (m) => showFormError(formError, m),
    );
  } finally {
    createButton.disabled = false;
    createButton.textContent = 'Save note';
  }
});

// -------------------------------------------------------------- edit -----

function startEdit(li, note) {
  li.replaceChildren();

  const form = document.createElement('form');
  form.className = 'edit-form';
  form.setAttribute('aria-label', `Edit note "${note.title}"`);

  const titleField = document.createElement('div');
  titleField.className = 'field';
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  titleLabel.htmlFor = `edit-title-${note.id}`;
  const titleFieldInput = document.createElement('input');
  titleFieldInput.id = `edit-title-${note.id}`;
  titleFieldInput.type = 'text';
  titleFieldInput.value = note.title;
  titleFieldInput.required = true;
  const titleFieldError = document.createElement('p');
  titleFieldError.className = 'field-error';
  titleFieldError.hidden = true;
  titleField.append(titleLabel, titleFieldInput, titleFieldError);

  const bodyField = document.createElement('div');
  bodyField.className = 'field';
  const bodyLabel = document.createElement('label');
  bodyLabel.textContent = 'Body';
  bodyLabel.htmlFor = `edit-body-${note.id}`;
  const bodyFieldInput = document.createElement('textarea');
  bodyFieldInput.id = `edit-body-${note.id}`;
  bodyFieldInput.rows = 4;
  bodyFieldInput.value = note.body || '';
  const bodyFieldError = document.createElement('p');
  bodyFieldError.className = 'field-error';
  bodyFieldError.hidden = true;
  bodyField.append(bodyLabel, bodyFieldInput, bodyFieldError);

  const formErr = document.createElement('p');
  formErr.className = 'form-error';
  formErr.setAttribute('role', 'alert');
  formErr.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'note-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'secondary';
  cancelBtn.textContent = 'Cancel';
  actions.append(saveBtn, cancelBtn);

  form.append(titleField, bodyField, formErr, actions);
  li.appendChild(form);
  titleFieldInput.focus();
  titleFieldInput.select();

  const cancel = () => {
    focusAfterLoadId = note.id;
    loadNotes();
  };
  cancelBtn.addEventListener('click', cancel);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError(titleFieldInput, titleFieldError, null);
    showFieldError(bodyFieldInput, bodyFieldError, null);
    showFormError(formErr, null);

    const titleErr = validateTitle(titleFieldInput.value);
    const bodyErr = validateBody(bodyFieldInput.value);
    if (titleErr) showFieldError(titleFieldInput, titleFieldError, titleErr);
    if (bodyErr) showFieldError(bodyFieldInput, bodyFieldError, bodyErr);
    if (titleErr || bodyErr) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const updated = await api(`/notes/${note.id}`, {
        method: 'PUT',
        body: { title: titleFieldInput.value.trim(), body: bodyFieldInput.value },
      });
      focusAfterLoadId = note.id;
      announce(`Note "${updated.title}" updated.`);
      await loadNotes();
    } catch (err) {
      routeBackendError(
        err.message,
        (m) => showFieldError(titleFieldInput, titleFieldError, m),
        (m) => showFieldError(bodyFieldInput, bodyFieldError, m),
        (m) => showFormError(formErr, m),
      );
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// ------------------------------------------------------------ delete -----

function openDeleteDialog(note) {
  pendingDeleteId = note.id;
  pendingDeleteTitle = note.title;
  deleteDialogText.textContent = `Delete "${note.title}"? This cannot be undone.`;
  showFormError(deleteError, null);
  deleteConfirm.disabled = false;
  deleteConfirm.textContent = 'Delete';
  deleteDialog.showModal();
}

deleteCancel.addEventListener('click', () => deleteDialog.close());

deleteDialog.addEventListener('close', () => {
  // Focus returns to the Delete button of the note (or the create form
  // when the note is already gone).
  if (pendingDeleteId !== null) {
    const btn = notesList.querySelector(`li[data-id="${pendingDeleteId}"] button[data-action="delete"]`);
    if (btn) btn.focus();
    pendingDeleteId = null;
  }
});

deleteConfirm.addEventListener('click', async () => {
  if (pendingDeleteId === null) return;
  const id = pendingDeleteId;
  const title = pendingDeleteTitle;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Deleting…';
  try {
    await api(`/notes/${id}`, { method: 'DELETE' });
    pendingDeleteId = null;
    deleteDialog.close();
    announce(`Note "${title}" deleted.`);
    await loadNotes();
    titleInput.focus();
  } catch (err) {
    showFormError(deleteError, err.message);
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = 'Delete';
  }
});

retryButton.addEventListener('click', () => loadNotes());

loadNotes();
