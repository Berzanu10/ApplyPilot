/*
 * ApplyPilot — Popup controller
 * The same page is used as the toolbar popup and as the full-page options view
 * (options_ui). Full-page mode is detected with tabs.getCurrent().
 */
(() => {
  'use strict';

  const Shared = globalThis.ApplyPilotShared;
  const extensionAPI = Shared.extensionAPI;
  const IS_FIREFOX = typeof browser !== 'undefined' && /firefox|gecko/i.test(navigator.userAgent);

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const state = {
    profile: null,
    settings: null,
    savedSnapshot: '',
    isFullPage: false,
    activeTab: null,
    fillLanguage: 'auto',
    detectedLanguage: null,
    toastTimer: null,
    resetTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* ------------------------------------------------------------------ */
  /* Bootstrapping                                                       */
  /* ------------------------------------------------------------------ */

  async function init() {
    $('#appVersion').textContent = `v${extensionAPI.runtime.getManifest().version}`;

    const { profile, settings } = await Shared.loadState();
    state.profile = profile;
    state.settings = settings;
    state.fillLanguage = settings.defaultLanguage;
    state.isFullPage = await detectFullPage();
    document.body.classList.toggle('is-fullpage', state.isFullPage);

    bindTabs();
    bindHome();
    bindProfile();

    renderSettings();
    renderLanguage();
    populateProfileForm();
    renderProfileWarning();
    renderStats();

    if (state.isFullPage) {
      setupFullPage();
    } else {
      scanActiveTab();
    }
  }

  async function detectFullPage() {
    try {
      const tab = await extensionAPI.tabs.getCurrent();
      return Boolean(tab);
    } catch (_) {
      return false;
    }
  }

  function setupFullPage() {
    document.title = 'ApplyPilot – Profil & Ayarlar';
    setPageStatus('idle', 'Ayarlar sayfası', 'Bir form doldurmak için başvuru sayfasındayken araç çubuğundaki ApplyPilot simgesine tıkla veya Alt+Shift+F kısayolunu kullan.');
    $('#fillButton').disabled = true;
    switchTab('profile');
    if (location.hash === '#import') {
      const section = $('#importButton').closest('details');
      if (section) section.open = true;
      $('#importButton').scrollIntoView({ block: 'center' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  function bindTabs() {
    const tabs = $$('.tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        switchTab(next.dataset.tab);
        next.focus();
      });
    });
    $$('[data-goto]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.goto)));
  }

  function switchTab(name) {
    $$('.tab').forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.panel').forEach((panel) => {
      const active = panel.id === `panel-${name}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Home tab                                                            */
  /* ------------------------------------------------------------------ */

  function bindHome() {
    $('#fillButton').addEventListener('click', fillPage);

    $('#openFullPage').addEventListener('click', async () => {
      await extensionAPI.runtime.openOptionsPage();
      window.close();
    });

    $$('input[name="fillLanguage"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        state.fillLanguage = radio.value;
        renderLanguageHint();
      });
    });

    $$('[data-setting]').forEach((input) => {
      input.addEventListener('change', async () => {
        Shared.setPath(state.settings, input.dataset.setting, input.checked);
        state.settings = await Shared.saveSettings(state.settings);
      });
    });
  }

  function renderSettings() {
    $$('[data-setting]').forEach((input) => {
      input.checked = Boolean(Shared.getPath(state.settings, input.dataset.setting));
    });
  }

  function renderLanguage() {
    const radio = $(`input[name="fillLanguage"][value="${state.fillLanguage}"]`) || $('#lang-auto');
    radio.checked = true;
    renderLanguageHint();
  }

  function renderLanguageHint() {
    const hint = $('#langHint');
    if (state.fillLanguage === 'auto') {
      hint.textContent = state.detectedLanguage
        ? `Sayfa dili ${state.detectedLanguage === 'tr' ? 'Türkçe' : 'İngilizce'} algılandı; ${state.detectedLanguage === 'tr' ? 'Türkçe' : 'İngilizce'} profilin kullanılacak.`
        : 'Otomatik modda sayfanın dili algılanır ve uygun profil kullanılır.';
    } else {
      hint.textContent = `Sayfa dilinden bağımsız olarak ${state.fillLanguage === 'tr' ? 'Türkçe' : 'İngilizce'} profilin kullanılacak.`;
    }
  }

  function setPageStatus(status, host, meta) {
    const card = $('#pageCard');
    card.dataset.status = status;
    if (host !== null && host !== undefined) $('#pageHost').textContent = host;
    if (meta !== null && meta !== undefined) $('#pageMeta').textContent = meta;
  }

  function setLanguageChip(language) {
    const chip = $('#pageLangChip');
    if (!language) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.textContent = language === 'tr' ? 'Sayfa: TR' : 'Sayfa: EN';
  }

  async function scanActiveTab() {
    let tab = null;
    try {
      tab = await Shared.getActiveTab();
    } catch (_) {
      tab = null;
    }
    state.activeTab = tab;

    if (!tab) {
      setPageStatus('error', 'Sekme bulunamadı', 'Aktif sekmeye erişilemedi.');
      $('#fillButton').disabled = true;
      return;
    }

    setPageStatus('loading', Shared.getHostLabel(tab.url) || tab.title || 'Bu sayfa', 'Form alanları taranıyor…');

    if (Shared.isRestrictedUrl(tab.url)) {
      setPageStatus('error', null, 'Tarayıcı, bu sayfada (sistem/mağaza sayfaları) eklentilerin çalışmasına izin vermiyor.');
      $('#fillButton').disabled = true;
      return;
    }

    try {
      const result = await Shared.runEngine(tab.id, 'scan', { language: state.fillLanguage });
      if (!result.ok) throw new Error(result.errors[0] || 'SCAN_FAILED');

      state.detectedLanguage = result.detectedLanguage;
      setLanguageChip(result.detectedLanguage);
      renderLanguageHint();

      if (result.total === 0) {
        setPageStatus('idle', null, 'Bu sayfada doldurulabilir form alanı bulunamadı.');
      } else {
        const frames = result.frames > 1 ? ` · ${result.frames} çerçeve` : '';
        setPageStatus('ok', null, `${result.total} form alanı bulundu · ${result.matched} tanesi tanındı${frames}`);
      }
    } catch (error) {
      setPageStatus('error', null, Shared.describeError(error));
    }
  }

  async function fillPage() {
    if (!state.activeTab) return;

    if (isProfileDirty()) {
      const saved = await saveProfile({ silent: true });
      if (!saved) {
        switchTab('profile');
        return;
      }
    }

    const button = $('#fillButton');
    button.disabled = true;
    button.classList.add('is-loading');
    $('#fillButtonLabel').textContent = 'Dolduruluyor…';

    try {
      const summary = await Shared.fillTab(state.activeTab.id, {
        profile: state.profile,
        settings: state.settings,
        language: state.fillLanguage
      });
      renderFillResult(summary);
      renderStats();
    } catch (error) {
      renderFillError(Shared.describeError(error));
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
      $('#fillButtonLabel').textContent = 'Sayfayı Doldur';
    }
  }

  function renderFillResult(summary) {
    const box = $('#fillResult');
    const chips = $('#resultChips');
    chips.replaceChildren();
    box.hidden = false;

    if (!summary.ok) {
      renderFillError(Shared.describeError(summary.errors[0]));
      return;
    }

    const languageLabel = summary.language === 'tr' ? 'Türkçe' : 'İngilizce';
    const details = [`Dil: ${languageLabel}`];
    if (summary.skipped) details.push(`${summary.skipped} atlandı`);
    if (summary.empty) details.push(`${summary.empty} alan için profilde veri yok`);
    if (summary.failed) details.push(`${summary.failed} hata`);

    if (summary.filled > 0) {
      box.dataset.variant = 'success';
      $('#resultTitle').textContent = `✓ ${summary.filled} alan dolduruldu`;
    } else {
      box.dataset.variant = 'info';
      $('#resultTitle').textContent = summary.total === 0
        ? 'Bu sayfada form alanı bulunamadı'
        : 'Doldurulacak uygun boş alan bulunamadı';
      if (summary.skipped && !state.settings.overwriteExisting) details.push('dolu alanlar için "üzerine yaz" seçeneğini açabilirsin');
    }
    $('#resultSub').textContent = details.join(' · ');

    for (const key of summary.fields) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = Shared.FIELD_LABELS[key] || key;
      chips.appendChild(chip);
    }
  }

  function renderFillError(message) {
    const box = $('#fillResult');
    box.hidden = false;
    box.dataset.variant = 'error';
    $('#resultTitle').textContent = 'Form doldurulamadı';
    $('#resultSub').textContent = message;
    $('#resultChips').replaceChildren();
  }

  async function renderStats() {
    const stats = await Shared.getStats();
    const line = $('#statsLine');
    if (!stats.totalRuns) {
      line.textContent = '';
      return;
    }
    const last = stats.lastFillAt ? new Date(stats.lastFillAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
    line.textContent = `Toplam ${stats.totalFilled} alan · ${stats.totalRuns} doldurma · Son: ${last}`;
  }

  function renderProfileWarning() {
    const completeness = Shared.profileCompleteness(state.profile);
    $('#completenessText').textContent = `%${completeness}`;
    $('#profileWarning').hidden = completeness >= 30;
  }

  /* ------------------------------------------------------------------ */
  /* Profile tab                                                         */
  /* ------------------------------------------------------------------ */

  function bindProfile() {
    const form = $('#profileForm');

    $$('textarea[data-counter]').forEach((textarea) => {
      const counter = document.createElement('span');
      counter.className = 'counter';
      textarea.insertAdjacentElement('afterend', counter);
      textarea.addEventListener('input', () => updateCounter(textarea));
    });

    form.addEventListener('input', (event) => {
      if (event.target.classList) event.target.classList.remove('is-invalid');
      updateDirtyState();
    });
    form.addEventListener('change', updateDirtyState);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveProfile();
    });

    $('#f-noticeUnit').addEventListener('change', syncNoticeAmount);
    $('#saveButton').addEventListener('click', () => saveProfile());

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProfile();
      }
    });

    $('#exportButton').addEventListener('click', exportData);
    $('#importButton').addEventListener('click', startImport);
    $('#importFile').addEventListener('change', importData);
    $('#resetButton').addEventListener('click', confirmReset);

    window.addEventListener('beforeunload', (event) => {
      if (state.isFullPage && isProfileDirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  function updateCounter(textarea) {
    const counter = textarea.nextElementSibling;
    if (counter && counter.classList.contains('counter')) {
      counter.textContent = `${textarea.value.length.toLocaleString('tr-TR')} karakter`;
    }
  }

  function syncNoticeAmount() {
    const immediate = $('#f-noticeUnit').value === 'immediate';
    const amount = $('#f-noticeAmount');
    amount.disabled = immediate;
    if (immediate) amount.value = '';
  }

  function populateProfileForm() {
    $$('[data-path]').forEach((field) => {
      const value = Shared.getPath(state.profile, field.dataset.path);
      field.value = value === undefined || value === null ? '' : value;
      field.classList.remove('is-invalid');
    });
    $$('[data-setting-field]').forEach((field) => {
      field.value = Shared.getPath(state.settings, field.dataset.settingField);
    });
    $$('textarea[data-counter]').forEach(updateCounter);
    syncNoticeAmount();
    state.savedSnapshot = snapshot();
    updateDirtyState();
  }

  function collectForm() {
    const profile = Shared.clone(state.profile);
    const settings = Shared.clone(state.settings);
    $$('[data-path]').forEach((field) => {
      const value = field.tagName === 'TEXTAREA' ? field.value.replace(/\s+$/, '').replace(/^\s+/, '') : field.value.trim();
      Shared.setPath(profile, field.dataset.path, value);
    });
    $$('[data-setting-field]').forEach((field) => {
      Shared.setPath(settings, field.dataset.settingField, field.value);
    });
    return { profile, settings };
  }

  function snapshot() {
    return JSON.stringify(collectForm());
  }

  function isProfileDirty() {
    return snapshot() !== state.savedSnapshot;
  }

  function updateDirtyState() {
    const dirty = isProfileDirty();
    $('#dirtyDot').hidden = !dirty;
    $('.save-bar').classList.toggle('is-dirty', dirty);
    $('#saveStatus').textContent = dirty ? 'Kaydedilmemiş değişiklikler var' : 'Tüm değişiklikler kaydedildi';
  }

  function fieldByPath(path) {
    return $(`[data-path="${path}"]`);
  }

  function normalizeUrl(value) {
    if (!value) return { value: '' };
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
    try {
      const url = new URL(withScheme);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return { error: true };
      return { value: url.href.replace(/\/$/, '') };
    } catch (_) {
      return { error: true };
    }
  }

  function normalizeAmount(value) {
    if (!value) return { value: '' };
    const cleaned = value.replace(/[^\d.,]/g, '');
    const digits = /^\d{1,3}([.,]\d{3})+$/.test(cleaned) ? cleaned.replace(/[.,]/g, '') : cleaned.replace(',', '.');
    const number = Number(digits);
    if (!Number.isFinite(number) || number <= 0) return { error: true };
    return { value: String(Math.round(number)) };
  }

  /** Validates and normalizes the collected profile in place. */
  function validateProfile(profile) {
    const errors = [];

    const email = profile.personal.email;
    if (email && !EMAIL_PATTERN.test(email)) {
      errors.push({ path: 'personal.email', message: 'Geçerli bir e-posta adresi girin.' });
    }

    for (const key of Object.keys(profile.links)) {
      const result = normalizeUrl(profile.links[key]);
      if (result.error) errors.push({ path: `links.${key}`, message: 'Linklerden biri geçerli bir adres değil.' });
      else profile.links[key] = result.value;
    }

    for (const key of ['salaryTRY', 'salaryUSD', 'salaryEUR']) {
      const result = normalizeAmount(profile.career[key]);
      if (result.error) errors.push({ path: `career.${key}`, message: 'Maaş tutarı sadece sayı olmalı (örn. 85000).' });
      else profile.career[key] = result.value;
    }

    const years = profile.career.yearsOfExperience;
    if (years !== '' && !(Number(years) >= 0 && Number(years) <= 60)) {
      errors.push({ path: 'career.yearsOfExperience', message: 'Deneyim yılı 0 ile 60 arasında olmalı.' });
    }

    const notice = profile.career.noticeAmount;
    if (profile.career.noticeUnit === 'immediate') {
      profile.career.noticeAmount = '';
    } else if (notice !== '' && !(Number.isInteger(Number(notice)) && Number(notice) >= 0)) {
      errors.push({ path: 'career.noticeAmount', message: 'İhbar süresi tam sayı olmalı.' });
    } else if (notice !== '' && !profile.career.noticeUnit) {
      errors.push({ path: 'career.noticeUnit', message: 'İhbar süresi için bir birim seçin.' });
    }

    return errors;
  }

  function showErrors(errors) {
    $$('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    errors.forEach((error) => {
      const field = fieldByPath(error.path);
      if (field) field.classList.add('is-invalid');
    });
    const first = fieldByPath(errors[0].path);
    if (first) {
      const section = first.closest('details');
      if (section) section.open = true;
      first.focus();
    }
    showToast(errors[0].message, 'error');
  }

  async function saveProfile(options = {}) {
    const { profile, settings } = collectForm();
    const errors = validateProfile(profile);
    if (errors.length) {
      switchTab('profile');
      showErrors(errors);
      return false;
    }

    state.profile = await Shared.saveProfile(profile);
    state.settings = await Shared.saveSettings(Object.assign(Shared.clone(state.settings), { defaultLanguage: settings.defaultLanguage }));

    populateProfileForm();
    renderProfileWarning();
    if (!options.silent) showToast('Değişiklikler kaydedildi ✓', 'success');
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Import / export / reset                                             */
  /* ------------------------------------------------------------------ */

  function exportData() {
    const payload = {
      app: 'ApplyPilot',
      version: extensionAPI.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      profile: state.profile,
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `applypilot-profil-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Profil JSON olarak indirildi', 'success');
  }

  async function startImport() {
    // Firefox closes the popup when the file picker opens, so import from the full page.
    if (IS_FIREFOX && !state.isFullPage) {
      await extensionAPI.tabs.create({ url: extensionAPI.runtime.getURL('popup/popup.html#import') });
      window.close();
      return;
    }
    $('#importFile').click();
  }

  async function importData(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
      const incomingProfile = data && (data.profile || data);
      if (!incomingProfile || typeof incomingProfile !== 'object' || !incomingProfile.personal) {
        throw new Error('INVALID_FILE');
      }
      state.profile = await Shared.saveProfile(Shared.mergeDeep(Shared.DEFAULT_PROFILE, incomingProfile));
      if (data.settings) state.settings = await Shared.saveSettings(Shared.mergeDeep(Shared.DEFAULT_SETTINGS, data.settings));

      populateProfileForm();
      renderSettings();
      renderProfileWarning();
      showToast('Profil içe aktarıldı ✓', 'success');
    } catch (_) {
      showToast('Dosya okunamadı. ApplyPilot dışa aktarma dosyası seçin.', 'error');
    }
  }

  async function confirmReset() {
    const button = $('#resetButton');
    if (!button.classList.contains('is-confirming')) {
      button.classList.add('is-confirming');
      button.textContent = 'Emin misin? Tekrar tıkla';
      clearTimeout(state.resetTimer);
      state.resetTimer = setTimeout(() => {
        button.classList.remove('is-confirming');
        button.textContent = 'Tüm Verileri Sil';
      }, 4000);
      return;
    }

    clearTimeout(state.resetTimer);
    button.classList.remove('is-confirming');
    button.textContent = 'Tüm Verileri Sil';

    const { profile, settings } = await Shared.resetAll();
    state.profile = profile;
    state.settings = settings;
    state.fillLanguage = settings.defaultLanguage;
    populateProfileForm();
    renderSettings();
    renderLanguage();
    renderProfileWarning();
    renderStats();
    showToast('Tüm veriler silindi', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  function showToast(message, variant = 'info') {
    const toast = $('#toast');
    toast.textContent = message;
    toast.dataset.variant = variant;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  init().catch((error) => {
    console.error('[ApplyPilot] Popup init failed:', error);
    showToast('Eklenti başlatılamadı. Lütfen tekrar deneyin.', 'error');
  });
})();
