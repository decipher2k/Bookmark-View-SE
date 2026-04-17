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

function getBasePath() {
  return os.homedir();
}

function getBookmarksPath(browserId) {
  const browser = CHROMIUM_BROWSERS[browserId];

  if (!browser) {
    return null;
  }

  const platformKey = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  return path.join(getBasePath(), ...browser.profilePath[platformKey]);
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

/* ── Folder Operations ──────────────────────────────────────────────── */

function findFolderByPath(data, folderPath) {
  if (!folderPath || folderPath.length === 0) {
    return null;
  }

  const rootName = folderPath[0];
  let current = null;

  for (const root of Object.values(data.roots || {})) {
    if (root.type === 'folder' && root.name === rootName) {
      current = root;
      break;
    }
  }

  if (!current) {
    return null;
  }

  for (let i = 1; i < folderPath.length; i++) {
    const child = (current.children || []).find(
      (c) => c.type === 'folder' && c.name === folderPath[i]
    );
    if (!child) {
      return null;
    }
    current = child;
  }

  return current;
}

function nextChromiumId(data) {
  let max = 0;

  function walk(node) {
    if (!node) {
      return;
    }
    const id = Number.parseInt(node.id, 10);
    if (!Number.isNaN(id) && id > max) {
      max = id;
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }

  for (const root of Object.values(data.roots || {})) {
    walk(root);
  }

  return String(max + 1);
}

function collectChromiumFolderTree(node, lineage) {
  if (!node || node.type !== 'folder') {
    return [];
  }

  const currentPath = node.name ? [...lineage, node.name] : lineage;
  const result = [];

  if (node.name) {
    result.push({ name: node.name, path: currentPath });
  }

  for (const child of node.children || []) {
    if (child.type === 'folder') {
      result.push(...collectChromiumFolderTree(child, currentPath));
    }
  }

  return result;
}

function getChromiumFolderTree(browserId) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    return [];
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);
  const folders = [];

  for (const root of Object.values(data.roots || {})) {
    folders.push(...collectChromiumFolderTree(root, []));
  }

  return folders;
}

function createChromiumFolder(browserId, parentPath, name) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    throw new Error(`Browser ${browserId} is not available`);
  }

  const sanitizedName = String(name).trim().slice(0, 200);
  if (!sanitizedName) {
    throw new Error('Folder name is required');
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);

  const parent = findFolderByPath(data, parentPath);
  if (!parent) {
    throw new Error('Parent folder not found');
  }

  if (!parent.children) {
    parent.children = [];
  }

  const existing = parent.children.find((c) => c.type === 'folder' && c.name === sanitizedName);
  if (existing) {
    throw new Error('A folder with this name already exists');
  }

  const newFolder = {
    id: nextChromiumId(data),
    name: sanitizedName,
    type: 'folder',
    children: [],
    date_added: String(BigInt(Date.now()) * 1000n + 11644473600000000n),
    date_modified: '0'
  };

  parent.children.push(newFolder);
  fs.writeFileSync(browser.bookmarksPath, JSON.stringify(data, null, 3), 'utf8');

  return { name: sanitizedName, path: [...parentPath, sanitizedName] };
}

function renameChromiumFolder(browserId, folderPath, newName) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    throw new Error(`Browser ${browserId} is not available`);
  }

  const sanitizedName = String(newName).trim().slice(0, 200);
  if (!sanitizedName) {
    throw new Error('Folder name is required');
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);

  const folder = findFolderByPath(data, folderPath);
  if (!folder) {
    throw new Error('Folder not found');
  }

  folder.name = sanitizedName;
  fs.writeFileSync(browser.bookmarksPath, JSON.stringify(data, null, 3), 'utf8');
}

function deleteChromiumFolder(browserId, folderPath) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    throw new Error(`Browser ${browserId} is not available`);
  }

  if (!folderPath || folderPath.length < 2) {
    throw new Error('Cannot delete a root folder');
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);

  const parentPath = folderPath.slice(0, -1);
  const targetName = folderPath[folderPath.length - 1];
  const parent = findFolderByPath(data, parentPath);

  if (!parent || !parent.children) {
    throw new Error('Parent folder not found');
  }

  const index = parent.children.findIndex((c) => c.type === 'folder' && c.name === targetName);
  if (index === -1) {
    throw new Error('Folder not found');
  }

  parent.children.splice(index, 1);
  fs.writeFileSync(browser.bookmarksPath, JSON.stringify(data, null, 3), 'utf8');
}

function moveChromiumBookmarkToFolder(browserId, url, targetFolderPath) {
  const browser = detectChromiumBrowser(browserId);
  if (!browser.available) {
    throw new Error(`Browser ${browserId} is not available`);
  }

  const content = fs.readFileSync(browser.bookmarksPath, 'utf8');
  const data = JSON.parse(content);

  const target = findFolderByPath(data, targetFolderPath);
  if (!target) {
    throw new Error('Target folder not found');
  }

  let movedNode = null;

  function removeFirst(node) {
    if (!node || !node.children || movedNode) {
      return;
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child.type === 'url' && child.url === url && !movedNode) {
        movedNode = node.children.splice(i, 1)[0];
        return;
      }
      if (child.type === 'folder') {
        removeFirst(child);
      }
    }
  }

  for (const root of Object.values(data.roots || {})) {
    removeFirst(root);
    if (movedNode) {
      break;
    }
  }

  if (!movedNode) {
    throw new Error('Bookmark not found in this browser');
  }

  if (!target.children) {
    target.children = [];
  }
  target.children.push(movedNode);
  fs.writeFileSync(browser.bookmarksPath, JSON.stringify(data, null, 3), 'utf8');
}

module.exports = {
  CHROMIUM_BROWSERS,
  detectChromiumBrowser,
  parseChromiumBookmarks,
  deleteChromiumBookmarkByUrl,
  getChromiumFolderTree,
  createChromiumFolder,
  renameChromiumFolder,
  deleteChromiumFolder,
  moveChromiumBookmarkToFolder
};