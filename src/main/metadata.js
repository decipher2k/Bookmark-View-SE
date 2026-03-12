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
const { URL } = require('node:url');
const Database = require('better-sqlite3');
const { fetch } = require('undici');
const cheerio = require('cheerio');

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

function resolveMaybeRelative(baseUrl, candidate) {
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

class MetadataService {
  constructor({ userDataPath, maxConcurrency = 10, timeoutMs = 5000 }) {
    this.timeoutMs = timeoutMs;
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
    this.inFlight = new Set();
    this.queued = new Set();
    this.cacheTtlMs = 1000 * 60 * 60 * 24 * 7;
    this.failureTtlMs = 1000 * 60 * 60 * 12;
    this.database = new Database(path.join(userDataPath, 'metadata-cache.sqlite'));
    this.initializeDatabase();
  }

  initializeDatabase() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS metadata_cache (
        url TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        image TEXT,
        favicon TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        updated_at INTEGER NOT NULL,
        error TEXT
      );
    `);
  }

  close() {
    this.database.close();
  }

  getCacheEntry(url) {
    return this.database.prepare(`
      SELECT url, title, description, image, favicon, status, updated_at, error
      FROM metadata_cache
      WHERE url = ?
    `).get(url) || null;
  }

  getCacheEntries(urls) {
    const statement = this.database.prepare(`
      SELECT url, title, description, image, favicon, status, updated_at, error
      FROM metadata_cache
      WHERE url = ?
    `);

    const results = new Map();
    for (const url of urls) {
      const entry = statement.get(url);
      if (entry) {
        results.set(url, entry);
      }
    }
    return results;
  }

  shouldRefresh(cacheEntry) {
    if (!cacheEntry) {
      return true;
    }

    const age = Date.now() - cacheEntry.updated_at;
    if (cacheEntry.status === 'error') {
      return age > this.failureTtlMs;
    }

    return age > this.cacheTtlMs;
  }

  buildBookmarkMetadata(bookmark, cacheEntry) {
    const safeUrl = normalizeUrl(bookmark.url) || bookmark.url;
    const domain = getDomain(safeUrl);
    const fallbackFavicon = domain ? `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain)}` : null;

    return {
      title: cacheEntry?.title || bookmark.title,
      description: cacheEntry?.description || safeUrl,
      image: cacheEntry?.image || null,
      favicon: cacheEntry?.favicon || fallbackFavicon,
      status: cacheEntry?.status || 'pending',
      domain,
      lastUpdated: cacheEntry?.updated_at || null
    };
  }

  mergeBookmarksWithCache(bookmarks) {
    const cachedEntries = this.getCacheEntries(bookmarks.map((bookmark) => bookmark.url));

    return bookmarks.map((bookmark) => ({
      ...bookmark,
      metadata: this.buildBookmarkMetadata(bookmark, cachedEntries.get(bookmark.url) || null)
    }));
  }

  saveCacheEntry(url, payload) {
    this.database.prepare(`
      INSERT INTO metadata_cache (url, title, description, image, favicon, status, updated_at, error)
      VALUES (@url, @title, @description, @image, @favicon, @status, @updated_at, @error)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        image = excluded.image,
        favicon = excluded.favicon,
        status = excluded.status,
        updated_at = excluded.updated_at,
        error = excluded.error
    `).run({
      url,
      title: payload.title || null,
      description: payload.description || null,
      image: payload.image || null,
      favicon: payload.favicon || null,
      status: payload.status,
      updated_at: Date.now(),
      error: payload.error || null
    });
  }

  scheduleRefresh(bookmarks, onUpdate) {
    const uniqueBookmarks = new Map();
    for (const bookmark of bookmarks) {
      uniqueBookmarks.set(bookmark.url, bookmark);
    }

    for (const bookmark of uniqueBookmarks.values()) {
      const normalizedUrl = normalizeUrl(bookmark.url);

      if (!normalizedUrl) {
        continue;
      }

      const cacheEntry = this.getCacheEntry(normalizedUrl);
      if (!this.shouldRefresh(cacheEntry) || this.inFlight.has(normalizedUrl) || this.queued.has(normalizedUrl)) {
        continue;
      }

      this.queued.add(normalizedUrl);
      this.queue.push(async () => {
        this.queued.delete(normalizedUrl);
        this.inFlight.add(normalizedUrl);
        try {
          const result = await this.fetchMetadata(normalizedUrl, bookmark.title);
          this.saveCacheEntry(normalizedUrl, result);
          onUpdate(normalizedUrl, this.buildBookmarkMetadata(bookmark, this.getCacheEntry(normalizedUrl)));
        } finally {
          this.inFlight.delete(normalizedUrl);
        }
      });
    }

    this.pumpQueue();
  }

  pumpQueue() {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.activeCount += 1;

      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          this.activeCount -= 1;
          this.pumpQueue();
        });
    }
  }

  async fetchMetadata(url, fallbackTitle) {
    const domain = getDomain(url);
    const fallbackFavicon = domain ? `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain)}` : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'user-agent': 'BookmarkNewsViewer/1.0 (+https://localhost)',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('text/html')) {
        return {
          title: fallbackTitle,
          description: url,
          image: null,
          favicon: fallbackFavicon,
          status: 'error',
          error: `Unexpected response (${response.status})`
        };
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const title = $('meta[property="og:title"]').attr('content')
        || $('title').first().text().trim()
        || fallbackTitle;
      const description = $('meta[property="og:description"]').attr('content')
        || $('meta[name="description"]').attr('content')
        || url;
      const image = resolveMaybeRelative(url, $('meta[property="og:image"]').attr('content'));
      const favicon = resolveMaybeRelative(url, $('link[rel="icon"]').attr('href'))
        || resolveMaybeRelative(url, $('link[rel="shortcut icon"]').attr('href'))
        || resolveMaybeRelative(url, $('link[rel="apple-touch-icon"]').attr('href'))
        || fallbackFavicon;

      return {
        title,
        description,
        image,
        favicon,
        status: 'ready',
        error: null
      };
    } catch (error) {
      return {
        title: fallbackTitle,
        description: url,
        image: null,
        favicon: fallbackFavicon,
        status: 'error',
        error: error.message
      };
    }
  }
}

module.exports = {
  MetadataService,
  getDomain,
  normalizeUrl
};