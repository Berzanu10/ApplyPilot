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
      noticeAmount: '',
      noticeUnit: '',
      militaryStatus: '',
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
      resume: true
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
    noticePeriod: 'İhbar Süresi',
    militaryStatus: 'Askerlik',
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
    ['career.workMode'],
    ['career.noticeUnit'],
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

  async function loadState() {
    const stored = await extensionAPI.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.settings]);
    return {
      profile: mergeDeep(DEFAULT_PROFILE, stored[STORAGE_KEYS.profile]),
      settings: mergeDeep(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings])
    };
  }

  async function saveProfile(profile) {
    const clean = mergeDeep(DEFAULT_PROFILE, profile);
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
    return ensureDefaults();
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

  async function executeEngine(tabId, action, payload, allFrames) {
    const target = { tabId, allFrames };
    await extensionAPI.scripting.executeScript({ target, files: [CONTENT_SCRIPT] });
    return extensionAPI.scripting.executeScript({
      target,
      func: invokeEngine,
      args: [action, payload || {}]
    });
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
      errors: []
    };
    let bestWeight = -1;

    for (const entry of injectionResults || []) {
      const result = entry && entry.result;
      if (!result) continue;
      summary.frames += 1;
      if (!result.ok) {
        if (result.error) summary.errors.push(result.error);
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
   * Injects the engine into every accessible frame of the tab and runs `action`.
   * Cross-origin frames that activeTab cannot reach are skipped by the browser;
   * if the multi-frame injection fails entirely we retry on the top frame only.
   */
  async function runEngine(tabId, action, payload) {
    let results;
    try {
      results = await executeEngine(tabId, action, payload, true);
    } catch (firstError) {
      try {
        results = await executeEngine(tabId, action, payload, false);
      } catch (_) {
        throw firstError;
      }
    }
    return aggregateResults(action, results);
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
    if (!summary.ok) return 'Bu sayfada form doldurulamadı.';
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

    const summary = await runEngine(tabId, 'fill', {
      profile: state.profile,
      settings: state.settings,
      language
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
    if (/cannot access|cannot be scripted|missing host permission|permission|gallery|privileged|denied|not allowed/i.test(message)) {
      return 'Tarayıcı bu sayfaya erişime izin vermiyor. Sayfayı yenileyip eklenti simgesine tekrar tıklayın.';
    }
    if (/no tab|invalid tab|tab.*not found|no frame/i.test(message)) {
      return 'Aktif sekme bulunamadı. Sayfayı yenileyip tekrar deneyin.';
    }
    if (/ENGINE_UNAVAILABLE|NO_RESULT|frame/i.test(message)) {
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
    clone,
    mergeDeep,
    getPath,
    setPath,
    loadState,
    saveProfile,
    saveSettings,
    ensureDefaults,
    getStats,
    recordFill,
    resetAll,
    profileCompleteness,
    getActiveTab,
    isRestrictedUrl,
    getHostLabel,
    runEngine,
    fillTab,
    setBadge,
    showToastInTab,
    buildSummaryMessage,
    describeError
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
