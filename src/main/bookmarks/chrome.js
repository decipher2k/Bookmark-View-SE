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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROMIUM_BROWSERS = {
  chrome: {
    id: 'chrome',
    name: 'Google Chrome',
    profilePath: {
      win32: ['AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'],
      darwin: ['Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Bookmarks'],
      linux: ['.config', 'google-chrome', 'Default', 'Bookmarks']
    }
  },
  chromium: {
    id: 'chromium',
    name: 'Chromium',
    profilePath: {
      win32: ['AppData', 'Local', 'Chromium', 'User Data', 'Default', 'Bookmarks'],
      darwin: ['Library', 'Application Support', 'Chromium', 'Default', 'Bookmarks'],
      linux: ['.config', 'chromium', 'Default', 'Bookmarks']
    }
  },
  edge: {
    id: 'edge',
    name: 'Microsoft Edge',
    profilePath: {
      win32: ['AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks'],
      darwin: ['Library', 'Application Support', 'Microsoft Edge', 'Default', 'Bookmarks'],
      linux: ['.config', 'microsoft-edge', 'Default', 'Bookmarks']
    }
  }
};

function resolveHomePath(segments) {
  return path.join(os.homedir(), ...segments);
}

function getBasePath(platformKey) {
  if (platformKey === 'win32') {
    return process.env.LOCALAPPDATA || resolveHomePath(['AppData', 'Local']);
  }

  return os.homedir();
}

function getBookmarksPath(browserId) {
  const browser = CHROMIUM_BROWSERS[browserId];

  if (!browser) {
    return null;
  }

  const platformKey = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return path.join(getBasePath(platformKey), ...browser.profilePath[platformKey]);
}

function detectChromiumBrowser(browserId) {
  const browser = CHROMIUM_BROWSERS[browserId];
  const bookmarksPath = getBookmarksPath(browserId);

  return {
    id: browser.id,
    name: browser.name,
    type: 'chromium',
    bookmarksPath,
    available: Boolean(bookmarksPath && fs.existsSync(bookmarksPath))
  };
}

function convertChromiumDate(value) {
  if (!value) {
    return null;
  }

  const numeric = Number.parseInt(value, 10);

  if (Number.isNaN(numeric)) {
    return null;
  }

  const chromeEpochStart = Date.UTC(1601, 0, 1);
  return chromeEpochStart + Math.floor(numeric / 1000);
}

function walkNode(node, browser, lineage, results) {
  if (!node) {
    return;
  }

  if (node.type === 'folder') {
    const nextLineage = node.name ? [...lineage, node.name] : lineage;
    for (const child of node.children || []) {
      walkNode(child, browser, nextLineage, results);
    }
    return;
  }

  if (node.type !== 'url' || !node.url) {
    return;
  }

  results.push({
    id: `${browser.id}:${node.id || node.url}`,
    browserId: browser.id,
    browserName: browser.name,
    title: node.name || node.url,
    url: node.url,
    categoryPath: lineage,
    topLevelCategory: lineage[0] || 'Unsorted',
    dateAdded: convertChromiumDate(node.date_added)
  });
}

function parseChromiumBookmarks(browserId) {
  const browser = detectChromiumBrowser(browserId);

  if (!browser.available) {
    return [];
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);
  const results = [];

  for (const root of Object.values(data.roots || {})) {
    walkNode(root, browser, [], results);
  }

  return results;
}

function deleteChromiumBookmarkByUrl(browserId, url) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    return false;
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);
  let found = false;

  function removeFromNode(node) {
    if (!node || !node.children) {
      return;
    }

    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child.type === 'url' && child.url === url) {
        node.children.splice(i, 1);
        found = true;
      } else if (child.type === 'folder') {
        removeFromNode(child);
      }
    }
  }

  for (const root of Object.values(data.roots || {})) {
    removeFromNode(root);
  }

  if (found) {
    fs.writeFileSync(browser.bookmarksPath, JSON.stringify(data, null, 3), 'utf8');
  }

  return found;
}

module.exports = {
  CHROMIUM_BROWSERS,
  detectChromiumBrowser,
  parseChromiumBookmarks,
  deleteChromiumBookmarkByUrl
};