/*
 * Copyright 2026 Dennis Michael Heine
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell, nativeTheme } = require('electron');

const { detectChromiumBrowser, parseChromiumBookmarks, deleteChromiumBookmarkByUrl } = require('./bookmarks/chrome');
const { detectFirefoxBrowser, parseFirefoxBookmarks, deleteFirefoxBookmarkByUrl } = require('./bookmarks/firefox');
const { MetadataService, getDomain, normalizeUrl } = require('./metadata');

let store = null;

let mainWindow = null;
let metadataService = null;

async function initializeStore() {
  if (store) {
    return store;
  }

  const { default: Store } = await import('electron-store');
  store = new Store({
    defaults: {
      hiddenUrls: [],
      selectedBrowsers: []
    }
  });

  return store;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    backgroundColor: '#f3f1eb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  return mainWindow;
}

function getDetectedBrowsers() {
  return [
    detectChromiumBrowser('chrome'),
    detectChromiumBrowser('chromium'),
    detectChromiumBrowser('edge'),
    detectFirefoxBrowser()
  ];
}

function getSelectedBrowsers() {
  if (!store) {
    return [];
  }

  const detectedBrowsers = getDetectedBrowsers();
  const availableIds = new Set(detectedBrowsers.filter((browser) => browser.available).map((browser) => browser.id));
  const stored = store.get('selectedBrowsers', []);
  const filteredStored = stored.filter((browserId) => availableIds.has(browserId));

  if (filteredStored.length > 0) {
    return filteredStored;
  }

  return [...availableIds];
}

function getHiddenUrls() {
  if (!store) {
    return new Set();
  }

  return new Set(store.get('hiddenUrls', []));
}

function addHiddenUrl(url) {
  if (!store) {
    return;
  }

  const hidden = getHiddenUrls();
  hidden.add(url);
  store.set('hiddenUrls', [...hidden]);
}

function getBrowserBookmarks(browserId) {
  if (browserId === 'chrome' || browserId === 'chromium' || browserId === 'edge') {
    return parseChromiumBookmarks(browserId);
  }

  if (browserId === 'firefox') {
    return parseFirefoxBookmarks();
  }

  return [];
}

function mergeBookmarks(bookmarkRows) {
  const merged = new Map();

  for (const row of bookmarkRows) {
    const safeUrl = normalizeUrl(row.url);
    if (!safeUrl) {
      continue;
    }

    const existing = merged.get(safeUrl);
    const categoryKey = row.categoryPath.join(' / ');

    if (!existing) {
      merged.set(safeUrl, {
        id: safeUrl,
        url: safeUrl,
        title: row.title,
        domain: getDomain(safeUrl),
        browserIds: [row.browserId],
        browserNames: [row.browserName],
        categoryPaths: categoryKey ? [row.categoryPath] : [],
        topLevelCategories: row.topLevelCategory ? [row.topLevelCategory] : [],
        dateAdded: row.dateAdded || null
      });
      continue;
    }

    if (row.title && row.title.length > existing.title.length) {
      existing.title = row.title;
    }

    if (row.browserId && !existing.browserIds.includes(row.browserId)) {
      existing.browserIds.push(row.browserId);
    }

    if (row.browserName && !existing.browserNames.includes(row.browserName)) {
      existing.browserNames.push(row.browserName);
    }

    if (row.topLevelCategory && !existing.topLevelCategories.includes(row.topLevelCategory)) {
      existing.topLevelCategories.push(row.topLevelCategory);
    }

    if (categoryKey && !existing.categoryPaths.some((pathParts) => pathParts.join(' / ') === categoryKey)) {
      existing.categoryPaths.push(row.categoryPath);
    }

    if (row.dateAdded && (!existing.dateAdded || row.dateAdded > existing.dateAdded)) {
      existing.dateAdded = row.dateAdded;
    }
  }

  return [...merged.values()];
}

function loadBookmarks(browserIds) {
  const selectedBrowsers = Array.isArray(browserIds) && browserIds.length > 0 ? browserIds : getSelectedBrowsers();
  const hiddenUrls = getHiddenUrls();
  const warnings = [];
  const rawBookmarks = [];

  for (const browserId of selectedBrowsers) {
    try {
      rawBookmarks.push(...getBrowserBookmarks(browserId));
    } catch (error) {
      warnings.push(`${browserId}: ${error.message}`);
    }
  }

  const mergedBookmarks = mergeBookmarks(rawBookmarks)
    .filter((bookmark) => !hiddenUrls.has(bookmark.url));
  const bookmarksWithMetadata = metadataService.mergeBookmarksWithCache(mergedBookmarks);

  metadataService.scheduleRefresh(bookmarksWithMetadata, (url, metadata) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('metadata:updated', { url, metadata });
    }
  });

  store.set('selectedBrowsers', selectedBrowsers);

  return {
    bookmarks: bookmarksWithMetadata,
    warnings,
    selectedBrowsers
  };
}

async function deleteBookmarkFromBrowsers(url) {
  const selectedBrowsers = getSelectedBrowsers();

  for (const browserId of selectedBrowsers) {
    try {
      if (browserId === 'firefox') {
        deleteFirefoxBookmarkByUrl(url);
      } else {
        deleteChromiumBookmarkByUrl(browserId, url);
      }
    } catch (error) {
      if (browserId === 'firefox' && error.message?.includes('database is locked')) {
        let deleted = false;
        while (!deleted) {
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Firefox is open',
            message: 'Firefox is locking the bookmarks database.\nPlease close Firefox and then click "Try Again".',
            buttons: ['Try Again', 'Cancel'],
            defaultId: 0,
            cancelId: 1
          });
          if (response !== 0) {
            break;
          }
          try {
            deleteFirefoxBookmarkByUrl(url);
            deleted = true;
          } catch (retryError) {
            if (!retryError.message?.includes('database is locked')) {
              console.error('Delete failed:', retryError.message);
              break;
            }
          }
        }
      } else {
        console.error(`Failed to delete bookmark from ${browserId}:`, error.message);
      }
    }
  }
}

function sanitizeExternalUrl(url) {
  return normalizeUrl(url);
}

function showBookmarkContextMenu(url) {
  const safeUrl = sanitizeExternalUrl(url);

  const template = [
    {
      label: 'Open in Browser',
      enabled: Boolean(safeUrl),
      click: () => {
        if (safeUrl) {
          shell.openExternal(safeUrl);
        }
      }
    },
    {
      label: 'Copy URL',
      enabled: Boolean(safeUrl),
      click: () => {
        if (safeUrl) {
          clipboard.writeText(safeUrl);
        }
      }
    },
    {
      label: 'Hide from View',
      enabled: Boolean(safeUrl),
      click: () => {
        if (safeUrl) {
          addHiddenUrl(safeUrl);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('bookmark:hidden', { url: safeUrl });
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Delete Bookmark',
      enabled: Boolean(safeUrl),
      click: () => {
        if (safeUrl) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('bookmark:deleting', { url: safeUrl });
          }
          setImmediate(async () => {
            await deleteBookmarkFromBrowsers(safeUrl);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('bookmark:deleted', { url: safeUrl });
            }
          });
        }
      }
    }
  ];

  Menu.buildFromTemplate(template).popup({ window: mainWindow });
}

function registerIpc() {
  ipcMain.handle('app:get-initial-state', () => ({
    browsers: getDetectedBrowsers(),
    selectedBrowsers: getSelectedBrowsers(),
    systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }));

  ipcMain.handle('bookmarks:refresh', (_event, browserIds) => loadBookmarks(browserIds));

  ipcMain.handle('bookmark:open', async (_event, url) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) {
      return false;
    }

    await shell.openExternal(safeUrl);
    return true;
  });

  ipcMain.handle('bookmark:show-context-menu', (_event, url) => {
    showBookmarkContextMenu(url);
    return true;
  });
}

app.whenReady().then(async () => {
  await initializeStore();
  metadataService = new MetadataService({ userDataPath: app.getPath('userData') });
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (metadataService) {
    metadataService.close();
  }
});