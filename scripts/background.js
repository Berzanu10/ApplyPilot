/*
 * ApplyPilot — Background
 * Chrome runs this file as a Manifest V3 service worker (background.service_worker) and
 * pulls in shared.js with importScripts. Firefox / Zen run it as an event page
 * (background.scripts) where shared.js is already loaded before this file.
 */
if (typeof importScripts === 'function' && typeof globalThis.ApplyPilotShared === 'undefined') {
  importScripts('shared.js');
}

(() => {
  'use strict';

  const Shared = globalThis.ApplyPilotShared;
  const extensionAPI = Shared.extensionAPI;
  const menusAPI = extensionAPI.contextMenus || extensionAPI.menus;

  const MENU_FILL = 'applypilot-fill-page';
  const MENU_PROFILE = 'applypilot-open-profile';
  const COMMAND_FILL = 'fill-page';

  async function createContextMenus() {
    if (!menusAPI) return;
    try {
      await menusAPI.removeAll();
    } catch (_) { /* nothing to remove */ }

    const create = (properties) => {
      try {
        menusAPI.create(properties, () => void extensionAPI.runtime.lastError);
      } catch (_) { /* duplicate id after a fast restart */ }
    };

    create({ id: MENU_FILL, title: 'ApplyPilot ile bu formu doldur', contexts: ['page', 'frame', 'editable'] });
    create({ id: MENU_PROFILE, title: 'ApplyPilot profilimi düzenle', contexts: ['action'] });
  }

  async function flashBadge(tabId, text, color) {
    await Shared.setBadge(tabId, text, color);
    setTimeout(() => Shared.setBadge(tabId, ''), 3000);
  }

  async function fillFromBackground(tab) {
    const target = tab && typeof tab.id === 'number' && tab.id >= 0
      ? tab
      : await Shared.getActiveTab({ lastFocused: true });
    if (!target) return;

    if (Shared.isRestrictedUrl(target.url)) {
      await flashBadge(target.id, '!', '#dc2626');
      return;
    }

    try {
      const summary = await Shared.fillTab(target.id, { notifyInPage: true });
      if (!summary.ok) await flashBadge(target.id, '!', '#dc2626');
    } catch (error) {
      console.warn('[ApplyPilot] Fill failed:', error);
      await flashBadge(target.id, '!', '#dc2626');
    }
  }

  extensionAPI.runtime.onInstalled.addListener(async (details) => {
    await Shared.ensureDefaults();
    await createContextMenus();
    if (details && details.reason === 'install') {
      try {
        await extensionAPI.runtime.openOptionsPage();
      } catch (_) { /* options page unavailable */ }
    }
  });

  if (extensionAPI.runtime.onStartup) {
    extensionAPI.runtime.onStartup.addListener(() => {
      createContextMenus();
    });
  }

  if (extensionAPI.commands && extensionAPI.commands.onCommand) {
    extensionAPI.commands.onCommand.addListener((command, tab) => {
      if (command === COMMAND_FILL) fillFromBackground(tab);
    });
  }

  if (menusAPI && menusAPI.onClicked) {
    menusAPI.onClicked.addListener((info, tab) => {
      if (info.menuItemId === MENU_FILL) fillFromBackground(tab);
      if (info.menuItemId === MENU_PROFILE) extensionAPI.runtime.openOptionsPage();
    });
  }

  extensionAPI.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') Shared.setBadge(tabId, '');
  });

  extensionAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'applypilot-ui') return undefined;

    if (message.type === 'FILL_TAB' && typeof message.tabId === 'number') {
      Shared.fillTab(message.tabId, { language: message.language, notifyInPage: Boolean(message.notifyInPage) })
        .then((summary) => sendResponse({ ok: true, summary }))
        .catch((error) => sendResponse({ ok: false, error: Shared.describeError(error) }));
      return true;
    }

    if (message.type === 'OPEN_PROFILE') {
      extensionAPI.runtime.openOptionsPage()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    return undefined;
  });
})();
