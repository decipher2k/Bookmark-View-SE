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
const Database = require('better-sqlite3');

const FIREFOX_ROOT_GUIDS = [
  { guid: 'toolbar_____', label: 'Bookmarks Toolbar' },
  { guid: 'menu________', label: 'Bookmarks Menu' },
  { guid: 'unfiled_____', label: 'Other Bookmarks' },
  { guid: 'mobile______', label: 'Mobile Bookmarks' }
];

function getFirefoxBasePaths() {
  if (process.platform === 'win32') {
    return [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Mozilla', 'Firefox') : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox')
    ].filter(Boolean);
  }

  if (process.platform === 'darwin') {
    return [
      path.join(os.homedir(), 'Library', 'Application Support', 'Firefox'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'Firefox')
    ];
  }

  return [path.join(os.homedir(), '.mozilla', 'firefox')];
}

function parseIni(text) {
  const sections = [];
  let currentSection = null;

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = line.match(/^\[(.+)\]$/u);
    if (sectionMatch) {
      currentSection = { name: sectionMatch[1] };
      sections.push(currentSection);
      continue;
    }

    const [key, ...rest] = line.split('=');
    if (currentSection && key) {
      currentSection[key.trim()] = rest.join('=').trim();
    }
  }

  return sections;
}

function resolveProfilePath(basePath, profileEntry) {
  if (!profileEntry || !profileEntry.Path) {
    return null;
  }

  if (profileEntry.IsRelative === '1') {
    return path.join(basePath, profileEntry.Path);
  }

  return profileEntry.Path;
}

function getActiveFirefoxProfile() {
  for (const basePath of getFirefoxBasePaths()) {
    const profilesIniPath = path.join(basePath, 'profiles.ini');

    if (!fs.existsSync(profilesIniPath)) {
      continue;
    }

    const parsed = parseIni(fs.readFileSync(profilesIniPath, 'utf8'));

    // Modern Firefox uses [Install*] sections to track the active profile
    const installSection = parsed.find((section) => section.name?.startsWith('Install'));
    if (installSection && installSection.Default) {
      const installProfilePath = path.join(basePath, installSection.Default);
      const placesPath = path.join(installProfilePath, 'places.sqlite');
      if (fs.existsSync(placesPath)) {
        return {
          name: path.basename(installProfilePath),
          profilePath: installProfilePath,
          placesPath
        };
      }
    }

    // Fallback: legacy [Profile*] sections
    const profileSections = parsed.filter((section) => section.name?.startsWith('Profile'));

    // Try profiles in priority order, but verify places.sqlite exists
    const candidates = [
      profileSections.find((section) => section.Default === '1'),
      profileSections.find((section) => section.Name?.toLowerCase().includes('default-release')),
      profileSections.find((section) => section.Name?.toLowerCase().includes('default')),
      ...profileSections
    ].filter(Boolean);

    for (const candidate of candidates) {
      const profilePath = resolveProfilePath(basePath, candidate);
      if (!profilePath) {
        continue;
      }

      const placesPath = path.join(profilePath, 'places.sqlite');
      if (fs.existsSync(placesPath)) {
        return {
          name: candidate.Name || path.basename(profilePath),
          profilePath,
          placesPath
        };
      }
    }
  }

  return null;
}

function detectFirefoxBrowser() {
  const profile = getActiveFirefoxProfile();

  return {
    id: 'firefox',
    name: 'Mozilla Firefox',
    type: 'firefox',
    profilePath: profile?.profilePath || null,
    bookmarksPath: profile?.placesPath || null,
    available: Boolean(profile?.placesPath && fs.existsSync(profile.placesPath))
  };
}

function convertFirefoxDate(value) {
  if (!value) {
    return null;
  }

  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) {
    return null;
  }

  return Math.floor(numeric / 1000);
}

function withTemporaryCopy(sourcePath, callback) {
  const tempPath = path.join(os.tmpdir(), `bookmark-news-viewer-${process.pid}-${Date.now()}-${path.basename(sourcePath)}`);
  fs.copyFileSync(sourcePath, tempPath);

  try {
    return callback(tempPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function buildBookmarkRows(database) {
  const rows = database.prepare(`
    SELECT
      b.id,
      b.parent,
      b.type,
      b.title,
      b.fk,
      b.guid,
      b.dateAdded,
      p.url
    FROM moz_bookmarks AS b
    LEFT JOIN moz_places AS p ON b.fk = p.id
    WHERE b.type IN (1, 2)
    ORDER BY b.position ASC
  `).all();

  const byId = new Map();
  const childrenByParent = new Map();

  for (const row of rows) {
    byId.set(row.id, row);
    const siblings = childrenByParent.get(row.parent) || [];
    siblings.push(row);
    childrenByParent.set(row.parent, siblings);
  }

  return { byId, childrenByParent };
}

function walkFirefoxNode(node, browser, lineage, maps, results) {
  if (!node) {
    return;
  }

  if (node.type === 2) {
    const nextLineage = node.title ? [...lineage, node.title] : lineage;
    for (const child of maps.childrenByParent.get(node.id) || []) {
      walkFirefoxNode(child, browser, nextLineage, maps, results);
    }
    return;
  }

  if (node.type !== 1 || !node.url) {
    return;
  }

  results.push({
    id: `${browser.id}:${node.id}`,
    browserId: browser.id,
    browserName: browser.name,
    title: node.title || node.url,
    url: node.url,
    categoryPath: lineage,
    topLevelCategory: lineage[0] || 'Unsorted',
    dateAdded: convertFirefoxDate(node.dateAdded)
  });
}

function parseFirefoxBookmarks() {
  const browser = detectFirefoxBrowser();

  if (!browser.available) {
    return [];
  }

  return withTemporaryCopy(browser.bookmarksPath, (temporaryDbPath) => {
    const database = new Database(temporaryDbPath, { readonly: true, fileMustExist: true });

    try {
      const maps = buildBookmarkRows(database);
      const rootNodes = database.prepare(`
        SELECT id, guid, title
        FROM moz_bookmarks
        WHERE guid IN (?, ?, ?, ?)
      `).all(...FIREFOX_ROOT_GUIDS.map((root) => root.guid));

      const rootByGuid = new Map(rootNodes.map((row) => [row.guid, row]));
      const results = [];

      for (const rootConfig of FIREFOX_ROOT_GUIDS) {
        const rootNode = rootByGuid.get(rootConfig.guid);
        if (!rootNode) {
          continue;
        }

        for (const child of maps.childrenByParent.get(rootNode.id) || []) {
          if (child.type === 2) {
            walkFirefoxNode(child, browser, [], maps, results);
          } else if (child.type === 1 && child.url) {
            results.push({
              id: `${browser.id}:${child.id}`,
              browserId: browser.id,
              browserName: browser.name,
              title: child.title || child.url,
              url: child.url,
              categoryPath: [rootConfig.label],
              topLevelCategory: rootConfig.label,
              dateAdded: convertFirefoxDate(child.dateAdded)
            });
          }
        }
      }

      return results;
    } finally {
      database.close();
    }
  });
}

function deleteFirefoxBookmarkByUrl(url) {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    return false;
  }

  const database = new Database(browser.bookmarksPath, { fileMustExist: true, timeout: 5000 });
  try {
    // Try exact match first
    let placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url);

    // If not found, try without trailing slash or with it (normalizeUrl may add/remove one)
    if (!placeRow && url.endsWith('/')) {
      placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url.slice(0, -1));
    } else if (!placeRow) {
      placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url + '/');
    }

    if (!placeRow) {
      return false;
    }

    const deleted = database.prepare('DELETE FROM moz_bookmarks WHERE fk = ? AND type = 1').run(placeRow.id);
    return deleted.changes > 0;
  } finally {
    database.close();
  }
}

/* ── Folder Operations ──────────────────────────────────────────────── */

function findFirefoxFolderByPath(database, folderPath) {
  if (!folderPath || folderPath.length === 0) {
    return null;
  }

  const rootLabel = folderPath[0];
  const rootConfig = FIREFOX_ROOT_GUIDS.find((r) => r.label === rootLabel);
  if (!rootConfig) {
    return null;
  }

  const rootRow = database.prepare('SELECT id FROM moz_bookmarks WHERE guid = ?').get(rootConfig.guid);
  if (!rootRow) {
    return null;
  }

  let currentId = rootRow.id;

  for (let i = 1; i < folderPath.length; i++) {
    const child = database.prepare(
      'SELECT id FROM moz_bookmarks WHERE parent = ? AND type = 2 AND title = ?'
    ).get(currentId, folderPath[i]);
    if (!child) {
      return null;
    }
    currentId = child.id;
  }

  return currentId;
}

function collectFirefoxFolders(database, parentId, lineage, results) {
  const children = database.prepare(
    'SELECT id, title FROM moz_bookmarks WHERE parent = ? AND type = 2 ORDER BY position ASC'
  ).all(parentId);

  for (const child of children) {
    const childPath = [...lineage, child.title || ''];
    results.push({ name: child.title || '', path: childPath });
    collectFirefoxFolders(database, child.id, childPath, results);
  }
}

function getFirefoxFolderTree() {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    return [];
  }

  return withTemporaryCopy(browser.bookmarksPath, (temporaryDbPath) => {
    const database = new Database(temporaryDbPath, { readonly: true, fileMustExist: true });
    try {
      const results = [];

      for (const rootConfig of FIREFOX_ROOT_GUIDS) {
        const rootRow = database.prepare('SELECT id FROM moz_bookmarks WHERE guid = ?').get(rootConfig.guid);
        if (!rootRow) {
          continue;
        }
        results.push({ name: rootConfig.label, path: [rootConfig.label] });
        collectFirefoxFolders(database, rootRow.id, [rootConfig.label], results);
      }

      return results;
    } finally {
      database.close();
    }
  });
}

function createFirefoxFolder(parentPath, name) {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    throw new Error('Firefox is not available');
  }

  const sanitizedName = String(name).trim().slice(0, 200);
  if (!sanitizedName) {
    throw new Error('Folder name is required');
  }

  const database = new Database(browser.bookmarksPath, { fileMustExist: true, timeout: 5000 });
  try {
    const parentId = findFirefoxFolderByPath(database, parentPath);
    if (parentId === null) {
      throw new Error('Parent folder not found');
    }

    const existing = database.prepare(
      'SELECT id FROM moz_bookmarks WHERE parent = ? AND type = 2 AND title = ?'
    ).get(parentId, sanitizedName);
    if (existing) {
      throw new Error('A folder with this name already exists');
    }

    const maxPos = database.prepare(
      'SELECT MAX(position) AS maxPos FROM moz_bookmarks WHERE parent = ?'
    ).get(parentId);
    const position = (maxPos?.maxPos ?? -1) + 1;

    const now = Date.now() * 1000;
    database.prepare(
      'INSERT INTO moz_bookmarks (type, parent, title, position, dateAdded, lastModified) VALUES (2, ?, ?, ?, ?, ?)'
    ).run(parentId, sanitizedName, position, now, now);

    return { name: sanitizedName, path: [...parentPath, sanitizedName] };
  } finally {
    database.close();
  }
}

function renameFirefoxFolder(folderPath, newName) {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    throw new Error('Firefox is not available');
  }

  const sanitizedName = String(newName).trim().slice(0, 200);
  if (!sanitizedName) {
    throw new Error('Folder name is required');
  }

  const database = new Database(browser.bookmarksPath, { fileMustExist: true, timeout: 5000 });
  try {
    const folderId = findFirefoxFolderByPath(database, folderPath);
    if (folderId === null) {
      throw new Error('Folder not found');
    }

    database.prepare('UPDATE moz_bookmarks SET title = ?, lastModified = ? WHERE id = ?')
      .run(sanitizedName, Date.now() * 1000, folderId);
  } finally {
    database.close();
  }
}

function deleteFirefoxFolder(folderPath) {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    throw new Error('Firefox is not available');
  }

  if (!folderPath || folderPath.length < 2) {
    throw new Error('Cannot delete a root folder');
  }

  const database = new Database(browser.bookmarksPath, { fileMustExist: true, timeout: 5000 });
  try {
    const folderId = findFirefoxFolderByPath(database, folderPath);
    if (folderId === null) {
      throw new Error('Folder not found');
    }

    function deleteRecursive(id) {
      const children = database.prepare(
        'SELECT id, type FROM moz_bookmarks WHERE parent = ?'
      ).all(id);
      for (const child of children) {
        if (child.type === 2) {
          deleteRecursive(child.id);
        }
      }
      database.prepare('DELETE FROM moz_bookmarks WHERE id = ?').run(id);
    }

    deleteRecursive(folderId);
  } finally {
    database.close();
  }
}

function moveFirefoxBookmarkToFolder(url, targetFolderPath) {
  const browser = detectFirefoxBrowser();
  if (!browser.available) {
    throw new Error('Firefox is not available');
  }

  const database = new Database(browser.bookmarksPath, { fileMustExist: true, timeout: 5000 });
  try {
    const targetId = findFirefoxFolderByPath(database, targetFolderPath);
    if (targetId === null) {
      throw new Error('Target folder not found');
    }

    let placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url);
    if (!placeRow && url.endsWith('/')) {
      placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url.slice(0, -1));
    } else if (!placeRow) {
      placeRow = database.prepare('SELECT id FROM moz_places WHERE url = ?').get(url + '/');
    }
    if (!placeRow) {
      throw new Error('Bookmark not found in Firefox');
    }

    const bookmark = database.prepare(
      'SELECT id FROM moz_bookmarks WHERE fk = ? AND type = 1 LIMIT 1'
    ).get(placeRow.id);
    if (!bookmark) {
      throw new Error('Bookmark not found in Firefox');
    }

    const maxPos = database.prepare(
      'SELECT MAX(position) AS maxPos FROM moz_bookmarks WHERE parent = ?'
    ).get(targetId);
    const position = (maxPos?.maxPos ?? -1) + 1;

    database.prepare(
      'UPDATE moz_bookmarks SET parent = ?, position = ?, lastModified = ? WHERE id = ?'
    ).run(targetId, position, Date.now() * 1000, bookmark.id);
  } finally {
    database.close();
  }
}

module.exports = {
  detectFirefoxBrowser,
  parseFirefoxBookmarks,
  deleteFirefoxBookmarkByUrl,
  getFirefoxFolderTree,
  createFirefoxFolder,
  renameFirefoxFolder,
  deleteFirefoxFolder,
  moveFirefoxBookmarkToFolder
};