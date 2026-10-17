/*
 * ApplyPilot — Shared module
 * Loaded by the popup (<script>), the Chrome service worker (importScripts) and the
 * Firefox / Zen event page (background.scripts). Holds the cross-browser API wrapper,
 * the storage schema and the logic that injects the form engine into a tab.
 */
(function (root) {
  'use strict';

  const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;

  const CONTENT_SCRIPT = 'scripts/content.js';

  const STORAGE_KEYS = Object.freeze({
    profile: 'applypilot_profile',
    settings: 'applypilot_settings',
    stats: 'applypilot_stats'
  });

  const DEFAULT_PROFILE = Object.freeze({
    personal: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      birthDate: '',
      address: '',
      city: '',
      postalCode: '',
      country: ''
    },
    links: {
      linkedin: '',
      github: '',
      portfolio: '',
      website: '',
      kaggle: '',
      twitter: '',
      medium: ''
    },
    career: {
      currentTitle: '',
      currentCompany: '',
      yearsOfExperience: '',
      salaryTRY: '',
      salaryUSD: '',
      salaryEUR: '',
      preferredCurrency: 'TRY',
      salaryPeriod: 'monthly',
      workMode: '',
      workModes: [],
      noticeAmount: '',
      noticeUnit: '',
      militaryStatus: '',
      englishLevel: '',
      workAuthorization: '',
      visaDetails: '',
      requiresSponsorship: '',
      willingToRelocate: ''
    },
    tr: {
      coverLetter: '',
      summary: '',
      experience: '',
      education: ''
    },
    en: {
      coverLetter: '',
      summary: '',
      experience: '',
      education: ''
    },
    documents: {
      tr: { name: '', type: '', size: 0 },
      en: { name: '', type: '', size: 0 }
    }
  });

  const DEFAULT_SETTINGS = Object.freeze({
    defaultLanguage: 'auto',
    categories: {
      personal: true,
      links: true,
      career: true,
      salary: true,
      preferences: true,
      coverLetter: true,
      resume: true,
      documents: true
    },
    overwriteExisting: false,
    highlightFields: true,
    fallbackToOtherLanguage: true
  });

  const DEFAULT_STATS = Object.freeze({
    totalFilled: 0,
    totalRuns: 0,
    lastFillAt: ''
  });

  const FIELD_LABELS = Object.freeze({
    firstName: 'Ad',
    lastName: 'Soyad',
    fullName: 'Ad Soyad',
    email: 'E-posta',
    phone: 'Telefon',
    birthDate: 'Doğum Tarihi',
    address: 'Adres',
    city: 'Şehir',
    postalCode: 'Posta Kodu',
    country: 'Ülke',
    location: 'Konum',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    kaggle: 'Kaggle',
    twitter: 'X / Twitter',
    medium: 'Medium',
    portfolio: 'Portfolyo',
    website: 'Web Sitesi',
    currentTitle: 'Ünvan',
    currentCompany: 'Şirket',
    yearsOfExperience: 'Deneyim Yılı',
    salary: 'Maaş Beklentisi',
    salaryCurrency: 'Para Birimi',
    workMode: 'Çalışma Modu',
    resumeFile: 'CV Dosyası',
    noticePeriod: 'İhbar Süresi',
    militaryStatus: 'Askerlik',
    englishLevel: 'İngilizce Seviyesi',
    workAuthorization: 'Çalışma İzni',
    requiresSponsorship: 'Vize Sponsorluğu',
    willingToRelocate: 'Taşınma',
    coverLetter: 'Ön Yazı',
    summary: 'Özgeçmiş Özeti',
    experience: 'Deneyim',
    education: 'Eğitim'
  });

  const LANGUAGE_LABELS = Object.freeze({ auto: 'Otomatik', tr: 'Türkçe', en: 'English' });

  const COMPLETENESS_CHECKS = [
    ['personal.firstName'],
    ['personal.lastName'],
    ['personal.email'],
    ['personal.phone'],
    ['personal.city'],
    ['personal.country'],
    ['links.linkedin'],
    ['links.github', 'links.portfolio', 'links.website'],
    ['career.currentTitle'],
    ['career.salaryTRY', 'career.salaryUSD', 'career.salaryEUR'],
    ['career.workModes', 'career.workMode'],
    ['documents.tr.name', 'documents.en.name'],
    ['career.noticeUnit'],
    ['career.englishLevel'],
    ['tr.coverLetter', 'en.coverLetter'],
    ['tr.summary', 'en.summary']
  ];

  const RESTRICTED_URL_PATTERNS = [
    /^chrome:/i,
    /^chrome-extension:/i,
    /^chrome-search:/i,
    /^edge:/i,
    /^brave:/i,
    /^opera:/i,
    /^vivaldi:/i,
    /^about:/i,
    /^moz-extension:/i,
    /^resource:/i,
    /^view-source:/i,
    /^devtools:/i,
    /^data:/i,
    /^https?:\/\/chrome\.google\.com\/webstore/i,
    /^https?:\/\/chromewebstore\.google\.com/i,
    /^https?:\/\/microsoftedge\.microsoft\.com\/addons/i,
    /^https?:\/\/addons\.mozilla\.org/i,
    /^https?:\/\/accounts-static\.cdn\.mozilla\.net/i
  ];

  const WORK_MODE_KEYS = Object.freeze(['remote', 'hybrid', 'onsite']);
  const WORK_MODE_OPTIONS = Object.freeze([
    { id: 'remote', label: 'Uzaktan (Remote)' },
    { id: 'hybrid', label: 'Hibrit (Hybrid)' },
    { id: 'onsite', label: 'Ofisten (On-site)' }
  ]);

  const DOCUMENT_LANGUAGES = Object.freeze(['tr', 'en']);
  const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
  const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.rtf,.odt,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const DOCUMENT_TYPES = Object.freeze({
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/rtf': true,
    'text/rtf': true,
    'application/vnd.oasis.opendocument.text': true,
    'text/plain': true
  });
  const DOCUMENT_EXTENSIONS = Object.freeze(['pdf', 'doc', 'docx', 'rtf', 'odt', 'txt']);

  const IDB_NAME = 'applypilot';
  const IDB_STORE = 'files';

  /* ------------------------------------------------------------------ */
  /* Object helpers                                                      */
  /* ------------------------------------------------------------------ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Returns a copy of `base` where every key that also exists in `override`
   * with a compatible type is replaced. Unknown keys are dropped so the stored
   * schema always matches the current version.
   */
  function mergeDeep(base, override) {
    const output = {};
    for (const key of Object.keys(base)) {
      const baseValue = base[key];
      const overrideValue = isPlainObject(override) ? override[key] : undefined;
      if (isPlainObject(baseValue)) {
        output[key] = mergeDeep(baseValue, isPlainObject(overrideValue) ? overrideValue : {});
      } else if (Array.isArray(baseValue)) {
        output[key] = Array.isArray(overrideValue) ? overrideValue.slice() : baseValue.slice();
      } else if (overrideValue !== undefined && overrideValue !== null && typeof overrideValue === typeof baseValue) {
        output[key] = overrideValue;
      } else if (overrideValue !== undefined && overrideValue !== null && typeof baseValue === 'string' && typeof overrideValue === 'number') {
        output[key] = String(overrideValue);
      } else {
        output[key] = Array.isArray(baseValue) ? baseValue.slice() : baseValue;
      }
    }
    return output;
  }

  function getPath(object, path) {
    return path.split('.').reduce((acc, key) => (acc !== null && acc !== undefined ? acc[key] : undefined), object);
  }

  function setPath(object, path, value) {
    const keys = path.split('.');
    let cursor = object;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!isPlainObject(cursor[keys[i]])) cursor[keys[i]] = {};
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
    return object;
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  function normalizeWorkModes(career) {
    if (!career || typeof career !== 'object') return [];
    const incoming = Array.isArray(career.workModes) ? career.workModes.slice() : [];
    if (!incoming.length && career.workMode) incoming.push(career.workMode);
    const seen = new Set();
    const modes = [];
    for (const mode of incoming) {
      if (!WORK_MODE_KEYS.includes(mode) || seen.has(mode)) continue;
      seen.add(mode);
      modes.push(mode);
    }
    career.workModes = modes;
    career.workMode = modes[0] || '';
    return modes;
  }

  function migrateProfile(profile) {
    normalizeWorkModes(profile.career);
    return profile;
  }

  async function loadState() {
    const stored = await extensionAPI.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings]);
    return {
      profile: migrateProfile(mergeDeep(DEFAULT_PROFILE, stored[STORAGE_KEYS.profile])),
      settings: mergeDeep(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings])
    };
  }

  async function saveProfile(profile) {
    const clean = migrateProfile(mergeDeep(DEFAULT_PROFILE, profile));
    await extensionAPI.storage.local.set({ [STORAGE_KEYS.profile]: clean });
    return clean;
  }

  async function saveSettings(settings) {
    const clean = mergeDeep(DEFAULT_SETTINGS, settings);
    await extensionAPI.storage.local.set({ [STORAGE_KEYS.settings]: clean });
    return clean;
  }

  async function ensureDefaults() {
    const state = await loadState();
    const stats = await getStats();
    await extensionAPI.storage.local.set({
      [STORAGE_KEYS.profile]: state.profile,
      [STORAGE_KEYS.settings]: state.settings,
      [STORAGE_KEYS.stats]: stats
    });
    return state;
  }

  async function getStats() {
    const stored = await extensionAPI.storage.local.get(STORAGE_KEYS.stats);
    return mergeDeep(DEFAULT_STATS, stored[STORAGE_KEYS.stats]);
  }

  async function recordFill(filledCount) {
    const stats = await getStats();
    stats.totalRuns += 1;
    stats.totalFilled += Math.max(0, filledCount || 0);
    stats.lastFillAt = new Date().toISOString();
    await extensionAPI.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    return stats;
  }

  async function resetAll() {
    await extensionAPI.storage.local.remove([STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.stats]);
    await clearDocuments();
    return ensureDefaults();
  }

  /* ------------------------------------------------------------------ */
  /* CV / document files (IndexedDB)                                     */
  /* ------------------------------------------------------------------ */

  function openDocumentDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(IDB_STORE)) {
          request.result.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function documentKey(lang) {
    return `cv_${lang}`;
  }

  function documentMeta(record) {
    if (!record || !record.name) return { name: '', type: '', size: 0 };
    return { name: record.name, type: record.type || '', size: Number(record.size) || 0 };
  }

  async function saveDocument(lang, record) {
    const db = await openDocumentDb();
    try {
      await idbRequest(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(record, documentKey(lang)));
    } finally {
      db.close();
    }
  }

  async function getDocument(lang) {
    const db = await openDocumentDb();
    try {
      return (await idbRequest(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(documentKey(lang)))) || null;
    } finally {
      db.close();
    }
  }

  async function deleteDocument(lang) {
    const db = await openDocumentDb();
    try {
      await idbRequest(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(documentKey(lang)));
    } finally {
      db.close();
    }
  }

  async function clearDocuments() {
    try {
      const db = await openDocumentDb();
      try {
        await idbRequest(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).clear());
      } finally {
        db.close();
      }
    } catch (_) { /* first run or private mode */ }
  }

  function toArrayBuffer(bytes) {
    if (!bytes) return null;
    if (bytes instanceof ArrayBuffer) return bytes;
    if (ArrayBuffer.isView(bytes)) {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return null;
  }

  async function loadDocumentsForFill() {
    const documents = {};
    for (const lang of DOCUMENT_LANGUAGES) {
      const record = await getDocument(lang);
      const bytes = record && toArrayBuffer(record.bytes);
      if (!bytes) continue;
      documents[lang] = { name: record.name, type: record.type || 'application/pdf', bytes };
    }
    return documents;
  }

  function formatBytes(size) {
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isAllowedDocument(file) {
    const name = String((file && file.name) || '');
    const type = String((file && file.type) || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return DOCUMENT_TYPES[type] || DOCUMENT_EXTENSIONS.includes(ext);
  }

  function profileCompleteness(profile) {
    const done = COMPLETENESS_CHECKS.filter((paths) =>
      paths.some((path) => String(getPath(profile, path) || '').trim() !== '')
    ).length;
    return Math.round((done / COMPLETENESS_CHECKS.length) * 100);
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  async function getActiveTab(options = {}) {
    const query = options.lastFocused
      ? { active: true, lastFocusedWindow: true }
      : { active: true, currentWindow: true };
    const tabs = await extensionAPI.tabs.query(query);
    return tabs && tabs.length ? tabs[0] : null;
  }

  function isRestrictedUrl(url) {
    if (!url) return false;
    return RESTRICTED_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  function getHostLabel(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') return 'Yerel dosya';
      return parsed.hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Engine injection                                                    */
  /* ------------------------------------------------------------------ */

  const HOST_ORIGINS = { origins: ['http://*/*', 'https://*/*'] };

  // Called from a click handler. Firefox only shows the site-access prompt from a user gesture.
  function ensureHostAccess() {
    const perms = extensionAPI.permissions;
    if (!perms || typeof perms.request !== 'function') return Promise.resolve(false);
    try {
      return Promise.resolve(perms.request(HOST_ORIGINS)).catch(() => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  // Serialized into the page's own JS world. Must stay self-contained.
  function installPageBridge() {
    const root = typeof window !== 'undefined' ? window : globalThis;
    if (root.__applyPilotBridge) return;
    root.__applyPilotBridge = true;

    function nativeSet(el, value) {
      const tag = String(el.tagName || '').toUpperCase();
      const proto = tag === 'TEXTAREA'
        ? root.HTMLTextAreaElement.prototype
        : tag === 'SELECT'
          ? root.HTMLSelectElement.prototype
          : root.HTMLInputElement.prototype;
      const protoDesc = Object.getOwnPropertyDescriptor(proto, 'value');
      const ownDesc = Object.getOwnPropertyDescriptor(el, 'value');
      const protoSetter = protoDesc && protoDesc.set;
      const ownSetter = ownDesc && ownDesc.set;
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') {
        try { tracker.setValue(String(value) === '' ? ' ' : ''); } catch (_) { /* tracker is best-effort */ }
      }
      if (protoSetter && ownSetter && ownSetter !== protoSetter) protoSetter.call(el, value);
      else if (protoSetter) protoSetter.call(el, value);
      else el.value = value;
    }

    function emitInput(el, value) {
      const data = value == null ? null : String(value);
      try {
        el.dispatchEvent(new root.InputEvent('beforeinput', {
          bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data
        }));
      } catch (_) { /* InputEvent can be unavailable */ }
      try {
        el.dispatchEvent(new root.InputEvent('input', {
          bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data
        }));
      } catch (_) {
        el.dispatchEvent(new root.Event('input', { bubbles: true, composed: true }));
      }
      el.dispatchEvent(new root.Event('change', { bubbles: true, composed: true }));
    }

    function clickLikeUser(el) {
      const opts = { bubbles: true, cancelable: true, composed: true, view: root };
      try { el.dispatchEvent(new root.PointerEvent('pointerdown', opts)); } catch (_) { /* pointer events optional */ }
      try { el.dispatchEvent(new root.MouseEvent('mousedown', opts)); } catch (_) { /* ignore */ }
      try { el.dispatchEvent(new root.PointerEvent('pointerup', opts)); } catch (_) { /* ignore */ }
      try { el.dispatchEvent(new root.MouseEvent('mouseup', opts)); } catch (_) { /* ignore */ }
      try { el.click(); } catch (_) { /* not clickable */ }
    }

    root.document.addEventListener('applypilot-commit', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const el = (path && path[0]) || event.target;
      if (!el || typeof el.getAttribute !== 'function') return;
      const kind = el.getAttribute('data-applypilot-kind');
      if (!kind) return;
      const value = el.getAttribute('data-applypilot-value') || '';
      let ok = false;
      try {
        if (kind === 'text') {
          try { el.focus(); } catch (_) { /* not focusable */ }
          nativeSet(el, value);
          emitInput(el, value);
          if (String(el.value) !== String(value)) {
            try {
              el.focus();
              if (typeof el.select === 'function') el.select();
              root.document.execCommand('selectAll', false, null);
              root.document.execCommand('insertText', false, value);
            } catch (_) { /* execCommand can be disabled */ }
          }
          ok = String(el.value) === String(value) || String(el.value || '').length > 0;
        } else if (kind === 'type') {
          try { el.focus(); } catch (_) { /* not focusable */ }
          if (el.isContentEditable) {
            el.textContent = value;
          } else {
            nativeSet(el, value);
          }
          try {
            el.dispatchEvent(new root.InputEvent('input', {
              bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: value
            }));
          } catch (_) {
            el.dispatchEvent(new root.Event('input', { bubbles: true, composed: true }));
          }
          ok = String((el.value || el.textContent) || '').length > 0;
        } else if (kind === 'editable') {
          try { el.focus(); } catch (_) { /* not focusable */ }
          const selection = root.getSelection();
          const range = root.document.createRange();
          range.selectNodeContents(el);
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          let inserted = false;
          try { inserted = root.document.execCommand('insertText', false, value); } catch (_) { inserted = false; }
          if (!inserted || !String(el.textContent || '').trim()) el.textContent = value;
          emitInput(el, value);
          ok = String(el.textContent || '').trim().length > 0;
        } else if (kind === 'select') {
          try { el.focus(); } catch (_) { /* not focusable */ }
          nativeSet(el, value);
          emitInput(el, value);
          ok = String(el.value) === String(value);
        } else if (kind === 'check') {
          if (!el.checked && el.getAttribute('aria-checked') !== 'true') clickLikeUser(el);
          if (!el.checked && el.getAttribute('aria-checked') !== 'true') {
            const desc = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'checked');
            if (desc && desc.set) desc.set.call(el, true);
            else el.checked = true;
            if (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
              el.setAttribute('aria-checked', 'true');
            }
            emitInput(el, null);
          }
          ok = Boolean(el.checked) || el.getAttribute('aria-checked') === 'true';
        } else if (kind === 'click') {
          try { el.focus(); } catch (_) { /* not focusable */ }
          clickLikeUser(el);
          ok = true;
        } else if (kind === 'change') {
          emitInput(el, null);
          ok = true;
        } else if (kind === 'blur') {
          el.dispatchEvent(new root.Event('change', { bubbles: true, composed: true }));
          try { el.dispatchEvent(new root.FocusEvent('blur', { bubbles: true, composed: true })); } catch (_) { /* ignore */ }
          try { el.dispatchEvent(new root.FocusEvent('focusout', { bubbles: true, composed: true })); } catch (_) { /* ignore */ }
          try { el.blur(); } catch (_) { /* ignore */ }
          ok = true;
        }
      } catch (_) {
        ok = false;
      }
      if (ok) el.setAttribute('data-applypilot-committed', '1');
    }, true);
  }

  // Serialized by scripting.executeScript, so it must stay self-contained.
  function invokeEngine(action, payload) {
    const engine = globalThis.__ApplyPilotEngine || (typeof window !== 'undefined' ? window.__ApplyPilotEngine : undefined);
    if (!engine || typeof engine.run !== 'function') {
      return { ok: false, error: 'ENGINE_UNAVAILABLE' };
    }
    try {
      return engine.run(action, payload);
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  }

  function injectionErrorCode(error) {
    const message = String((error && error.message) || error || '');
    if (/cannot access|cannot be scripted|missing host permission|host permission|permission|denied|not allowed|error page|frame was removed|no frame|showing error/i.test(message)) {
      return 'FRAME_BLOCKED';
    }
    return message || 'FRAME_BLOCKED';
  }

  function isOversizedPayload(error) {
    return /clone|quota|message length|too large|max(?:imum)? size|serialized/i.test(String((error && error.message) || error || ''));
  }

  function isInjectableFrame(frame) {
    if (!frame || frame.errorOccurred || typeof frame.frameId !== 'number') return false;
    const url = String(frame.url || '');
    if (!url || url === 'about:blank' || /^about:srcdoc/i.test(url) || /^blob:/i.test(url) || /^data:/i.test(url)) return true;
    if (/^(chrome|chrome-untrusted|chrome-extension|chrome-search|edge|brave|opera|vivaldi|moz-extension|resource|devtools|view-source|about):/i.test(url)) return false;
    return true;
  }

  async function listInjectableFrames(tabId) {
    if (!extensionAPI.webNavigation || typeof extensionAPI.webNavigation.getAllFrames !== 'function') return null;
    try {
      const frames = await extensionAPI.webNavigation.getAllFrames({ tabId });
      if (!frames || !frames.length) return null;
      const injectable = frames.filter(isInjectableFrame);
      return injectable.length ? injectable : null;
    } catch (_) {
      return null;
    }
  }

  function payloadForTarget(target, payload) {
    const topOnly = !target.allFrames && !target.frameIds;
    if (!topOnly) return payload || {};
    return Object.assign({}, payload || {}, { walkFrames: true });
  }

  async function executeOnTarget(target, action, payload) {
    if (action === 'fill') {
      try {
        await extensionAPI.scripting.executeScript({
          target,
          world: 'MAIN',
          func: installPageBridge
        });
      } catch (_) { /* page world is optional; isolated filling still runs */ }
    }
    await extensionAPI.scripting.executeScript({ target, files: [CONTENT_SCRIPT] });
    return extensionAPI.scripting.executeScript({
      target,
      func: invokeEngine,
      args: [action, payloadForTarget(target, payload)]
    });
  }

  async function executeEngineSafe(target, action, payload) {
    try {
      return await executeOnTarget(target, action, payload);
    } catch (error) {
      if (action === 'fill' && payload && payload.documents && isOversizedPayload(error)) {
        try {
          return await executeOnTarget(target, action, Object.assign({}, payload, { documents: {} }));
        } catch (retryError) {
          return [{ result: { ok: false, error: injectionErrorCode(retryError) } }];
        }
      }
      return [{ result: { ok: false, error: injectionErrorCode(error) } }];
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function aggregateResults(action, injectionResults) {
    const summary = {
      ok: false,
      action,
      total: 0,
      matched: 0,
      filled: 0,
      skipped: 0,
      empty: 0,
      failed: 0,
      fields: [],
      language: null,
      detectedLanguage: null,
      frames: 0,
      blocked: 0,
      errors: []
    };
    let bestWeight = -1;

    for (const entry of injectionResults || []) {
      const result = entry && entry.result;
      if (!result) continue;
      summary.frames += 1;
      if (!result.ok) {
        if (result.error) summary.errors.push(result.error);
        if (result.error === 'FRAME_BLOCKED') summary.blocked += 1;
        continue;
      }
      summary.ok = true;
      for (const key of ['total', 'matched', 'filled', 'skipped', 'empty', 'failed']) {
        summary[key] += Number(result[key]) || 0;
      }
      if (Array.isArray(result.fields)) summary.fields.push(...result.fields);
      const weight = (Number(result.total) || 0) + (entry.frameId === 0 ? 0.5 : 0);
      if (weight > bestWeight) {
        bestWeight = weight;
        summary.language = result.language || null;
        summary.detectedLanguage = result.detectedLanguage || null;
      }
    }

    summary.fields = Array.from(new Set(summary.fields));
    if (!summary.ok && !summary.errors.length) summary.errors.push('NO_RESULT');
    return summary;
  }

  /**
   * Injects the engine into every frame of the tab and runs `action`.
   * A single all-frames call is the fast path. Frames it skipped are retried
   * one by one so one blocked iframe cannot cancel the rest.
   */
  async function runAcrossFrames(tabId, action, payload) {
    const batched = await executeEngineSafe({ tabId, allFrames: true }, action, payload);
    const results = Array.isArray(batched) ? batched.slice() : [];
    const frames = await listInjectableFrames(tabId);
    const seen = new Set(results.map((entry) => entry && entry.frameId).filter((id) => typeof id === 'number'));
    const hasFrameIds = seen.size > 0;
    const allFailed = !results.some((entry) => entry && entry.result && entry.result.ok);
    const missing = (frames || []).filter((frame) => !seen.has(frame.frameId));
    const retryFrames = !frames ? [] : (allFailed && !hasFrameIds ? frames : (hasFrameIds ? missing : []));

    if (retryFrames.length) {
      const extra = await Promise.all(retryFrames.map((frame) => (
        executeEngineSafe({ tabId, frameIds: [frame.frameId] }, action, payload)
      )));
      for (const batch of extra) {
        if (Array.isArray(batch)) results.push(...batch);
      }
    }

    const summary = aggregateResults(action, results);
    if (summary.ok && (summary.total > 0 || summary.blocked === 0)) return summary;

    const fallback = await executeEngineSafe({ tabId }, action, payload);
    const fallbackSummary = aggregateResults(action, fallback);
    if ((fallbackSummary.filled || 0) > 0 || (fallbackSummary.total || 0) > (summary.total || 0)) {
      return fallbackSummary;
    }
    if (fallbackSummary.ok) {
      fallbackSummary.blocked = (fallbackSummary.blocked || 0) + (summary.blocked || 0);
      fallbackSummary.errors = (summary.errors || []).concat(fallbackSummary.errors || []);
      return fallbackSummary;
    }
    return summary;
  }

  function preferSummary(current, next) {
    if (!next) return current;
    if ((next.filled || 0) > (current.filled || 0)) return next;
    if ((next.total || 0) > (current.total || 0)) return next;
    if (!current.ok && next.ok) return next;
    return current;
  }

  async function runEngine(tabId, action, payload) {
    let summary = await runAcrossFrames(tabId, action, payload);
    const shouldRetry = (action === 'scan' || action === 'fill') && (summary.total || 0) === 0;
    if (shouldRetry) {
      await delay(summary.blocked ? 400 : 650);
      const retry = await runAcrossFrames(tabId, action, payload);
      summary = preferSummary(summary, retry);
    }
    return summary;
  }

  async function setBadge(tabId, text, color) {
    try {
      await extensionAPI.action.setBadgeText({ tabId, text: text ? String(text) : '' });
      if (text) {
        await extensionAPI.action.setBadgeBackgroundColor({ tabId, color: color || '#16a34a' });
        if (typeof extensionAPI.action.setBadgeTextColor === 'function') {
          await extensionAPI.action.setBadgeTextColor({ tabId, color: '#ffffff' });
        }
      }
    } catch (_) {
      // The tab may have been closed meanwhile.
    }
  }

  async function showToastInTab(tabId, message, variant) {
    try {
      await extensionAPI.scripting.executeScript({
        target: { tabId },
        func: invokeEngine,
        args: ['toast', { message, variant }]
      });
    } catch (_) {
      // Top frame not accessible — nothing to show.
    }
  }

  function buildSummaryMessage(summary) {
    const blocked = summary && summary.errors && summary.errors.indexOf('FRAME_BLOCKED') !== -1;
    if (!summary.ok && blocked) {
      return 'Başvuru formu ayrı bir çerçevede. Site erişimini onaylayıp tekrar deneyin.';
    }
    if (!summary.ok) return 'Bu sayfada form doldurulamadı.';
    if (summary.total === 0 && summary.blocked) {
      return 'Başvuru çerçevesine erişilemedi. Site erişimini onaylayıp tekrar deneyin.';
    }
    if (summary.filled === 0) {
      return summary.total === 0
        ? 'Bu sayfada doldurulabilir form alanı bulunamadı.'
        : 'Eşleşen boş alan bulunamadı.';
    }
    const languageLabel = LANGUAGE_LABELS[summary.language] || '';
    return `${summary.filled} alan dolduruldu${languageLabel ? ` (${languageLabel})` : ''}.`;
  }

  async function fillTab(tabId, options = {}) {
    const state = options.profile && options.settings
      ? { profile: options.profile, settings: options.settings }
      : await loadState();
    const language = options.language || state.settings.defaultLanguage || 'auto';

    const documents = options.documents || await loadDocumentsForFill();
    const summary = await runEngine(tabId, 'fill', {
      profile: state.profile,
      settings: state.settings,
      language,
      documents
    });

    if (summary.ok) {
      await recordFill(summary.filled);
      await setBadge(tabId, summary.filled > 0 ? summary.filled : '');
    }
    if (options.notifyInPage) {
      await showToastInTab(tabId, buildSummaryMessage(summary), summary.ok && summary.filled > 0 ? 'success' : 'info');
    }
    return summary;
  }

  function describeError(error) {
    const message = String((error && error.message) || error || '');
    if (/FRAME_BLOCKED/i.test(message)) {
      return 'Başvuru formu ayrı bir çerçevede. Eklentinin site erişimini onaylayıp sayfayı yeniledikten sonra tekrar deneyin.';
    }
    if (/cannot access|cannot be scripted|missing host permission|permission|gallery|privileged|denied|not allowed/i.test(message)) {
      return 'Tarayıcı bu sayfaya erişime izin vermiyor. Eklentiyi güncelledikten sonra site erişimini onaylayın.';
    }
    if (/no tab|invalid tab|tab.*not found|no frame/i.test(message)) {
      return 'Aktif sekme bulunamadı. Sayfayı yenileyip tekrar deneyin.';
    }
    if (/ENGINE_UNAVAILABLE|NO_RESULT/i.test(message)) {
      return 'Sayfa henüz hazır değil. Birkaç saniye sonra tekrar deneyin.';
    }
    return `Beklenmeyen bir hata oluştu: ${message}`;
  }

  root.ApplyPilotShared = Object.freeze({
    extensionAPI,
    STORAGE_KEYS,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    FIELD_LABELS,
    LANGUAGE_LABELS,
    WORK_MODE_KEYS,
    WORK_MODE_OPTIONS,
    DOCUMENT_LANGUAGES,
    DOCUMENT_ACCEPT,
    MAX_DOCUMENT_BYTES,
    clone,
    mergeDeep,
    getPath,
    setPath,
    normalizeWorkModes,
    loadState,
    saveProfile,
    saveSettings,
    ensureDefaults,
    getStats,
    recordFill,
    resetAll,
    saveDocument,
    getDocument,
    deleteDocument,
    loadDocumentsForFill,
    documentMeta,
    formatBytes,
    isAllowedDocument,
    profileCompleteness,
    getActiveTab,
    isRestrictedUrl,
    getHostLabel,
    ensureHostAccess,
    runEngine,
    fillTab,
    setBadge,
    showToastInTab,
    buildSummaryMessage,
    describeError
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
