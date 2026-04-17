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

import { renderCategoryBar } from './components/category-bar.js';
import { createBookmarkCard } from './components/bookmark-card.js';
import { renderSearchControls } from './components/search-bar.js';
import { renderFolderManager, showFolderPrompt, showFolderConfirm } from './components/folder-manager.js';

const ALL_CATEGORY_ID = '__all__';

const state = {
  browsers: [],
  selectedBrowsers: [],
  bookmarks: [],
  activeCategory: ALL_CATEGORY_ID,
  activeSubcategory: '',
  searchQuery: '',
  sortMode: 'date',
  selectedUrl: '',
  warnings: [],
  loading: true,
  folderTrees: {},
  folderPanelOpen: false
};

const elements = {
  browserSelector: document.querySelector('#browser-selector'),
  searchControls: document.querySelector('#search-controls'),
  refreshButton: document.querySelector('#refresh-button'),
  foldersButton: document.querySelector('#folders-button'),
  folderPanel: document.querySelector('#folder-panel'),
  categoryBar: document.querySelector('#category-bar'),
  subcategoryBar: document.querySelector('#subcategory-bar'),
  cardsGrid: document.querySelector('#cards-grid'),
  emptyState: document.querySelector('#empty-state'),
  resultCount: document.querySelector('#result-count'),
  warningBanner: document.querySelector('#warning-banner')
};

function escapeSearch(value) {
  return value.trim().toLocaleLowerCase('de-DE');
}

function buildCategoryModels(bookmarks) {
  const counts = new Map();
  for (const bookmark of bookmarks) {
    for (const category of bookmark.topLevelCategories) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }

  const categories = [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'en'))
    .map(([category, count]) => ({ id: category, label: category, count }));

  return [
    { id: ALL_CATEGORY_ID, label: 'All', count: bookmarks.length },
    ...categories
  ];
}

function buildSubcategoryModels(bookmarks, activeCategory) {
  if (activeCategory === ALL_CATEGORY_ID) {
    return [];
  }

  const counts = new Map();
  for (const bookmark of bookmarks) {
    for (const categoryPath of bookmark.categoryPaths) {
      if (categoryPath[0] !== activeCategory || categoryPath.length < 2) {
        continue;
      }

      const label = categoryPath.slice(1).join(' / ');
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'en'))
    .map(([label, count]) => ({ id: label, label, count }));
}

function sortBookmarks(bookmarks) {
  const sorted = [...bookmarks];

  sorted.sort((left, right) => {
    if (state.sortMode === 'name') {
      return (left.metadata.title || left.title).localeCompare(right.metadata.title || right.title, 'en');
    }

    if (state.sortMode === 'domain') {
      return left.domain.localeCompare(right.domain, 'en')
        || (left.metadata.title || left.title).localeCompare(right.metadata.title || right.title, 'en');
    }

    return (right.dateAdded || 0) - (left.dateAdded || 0)
      || (left.metadata.title || left.title).localeCompare(right.metadata.title || right.title, 'de');
  });

  return sorted;
}

function getVisibleBookmarks() {
  const query = escapeSearch(state.searchQuery);

  const filtered = state.bookmarks.filter((bookmark) => {
    if (state.activeCategory !== ALL_CATEGORY_ID && !bookmark.topLevelCategories.includes(state.activeCategory)) {
      return false;
    }

    if (state.activeSubcategory) {
      const matchesSubcategory = bookmark.categoryPaths.some((pathParts) => {
        if (pathParts[0] !== state.activeCategory || pathParts.length < 2) {
          return false;
        }

        return pathParts.slice(1).join(' / ') === state.activeSubcategory;
      });

      if (!matchesSubcategory) {
        return false;
      }
    }

    if (!query) {
      return true;
    }

    const haystack = [
      bookmark.title,
      bookmark.url,
      bookmark.domain,
      bookmark.metadata.title,
      bookmark.metadata.description
    ].join(' ').toLocaleLowerCase('en-US');

    return haystack.includes(query);
  });

  return sortBookmarks(filtered);
}

function renderBrowserSelector() {
  // Browser selection removed – all available browsers are imported automatically
}

function renderWarnings() {
  const hasWarnings = state.warnings.length > 0;
  elements.warningBanner.hidden = !hasWarnings;
  elements.warningBanner.textContent = hasWarnings ? state.warnings.join(' | ') : '';
}

function renderSkeletonCards() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 8; index += 1) {
    const card = document.createElement('div');
    card.className = `bookmark-card skeleton-card${index === 0 ? ' is-featured' : ''}`;
    fragment.appendChild(card);
  }
  elements.cardsGrid.replaceChildren(fragment);
  elements.emptyState.hidden = true;
  if (elements.resultCount) {
    elements.resultCount.textContent = '0';
  }
}

function renderCards() {
  const visibleBookmarks = getVisibleBookmarks();
  const fragment = document.createDocumentFragment();

  visibleBookmarks.forEach((bookmark, index) => {
    const card = createBookmarkCard({
      bookmark,
      featured: index === 0,
      selected: state.selectedUrl === bookmark.url,
      onSelect: (url) => {
        state.selectedUrl = url;
        renderCards();
      },
      onOpen: (url) => window.bookmarkNews.openBookmark(url),
      onContextMenu: (url) => window.bookmarkNews.showBookmarkContextMenu(url)
    });
    fragment.appendChild(card);
  });

  elements.cardsGrid.replaceChildren(fragment);
  elements.emptyState.hidden = visibleBookmarks.length !== 0;
  if (elements.resultCount) {
    elements.resultCount.textContent = String(visibleBookmarks.length);
  }
}

function renderCategories() {
  const categories = buildCategoryModels(state.bookmarks);

  if (!categories.some((category) => category.id === state.activeCategory)) {
    state.activeCategory = ALL_CATEGORY_ID;
  }

  renderCategoryBar(elements.categoryBar, categories, state.activeCategory, (categoryId) => {
    state.activeCategory = categoryId;
    state.activeSubcategory = '';
    renderCategories();
    renderCards();
  });

  const subcategories = buildSubcategoryModels(state.bookmarks, state.activeCategory);
  if (!subcategories.some((subcategory) => subcategory.id === state.activeSubcategory)) {
    state.activeSubcategory = '';
  }

  if (subcategories.length > 0) {
    renderCategoryBar(
      elements.subcategoryBar,
      [{ id: '', label: 'All Subfolders', count: subcategories.reduce((sum, item) => sum + item.count, 0) }, ...subcategories],
      state.activeSubcategory,
      (subcategoryId) => {
        state.activeSubcategory = subcategoryId;
        renderCards();
      }
    );
  } else {
    elements.subcategoryBar.replaceChildren();
  }
}

function renderSearch() {
  renderSearchControls(elements.searchControls, {
    searchValue: state.searchQuery,
    sortValue: state.sortMode,
    onSearch: (value) => {
      state.searchQuery = value;
      renderCards();
    },
    onSort: (value) => {
      state.sortMode = value;
      renderCards();
    }
  });
}

async function refreshBookmarks() {
  state.loading = true;
  renderSkeletonCards();

  const result = await window.bookmarkNews.refreshBookmarks(state.selectedBrowsers);
  state.bookmarks = result.bookmarks;
  state.warnings = result.warnings;
  state.selectedBrowsers = result.selectedBrowsers;
  state.folderTrees = result.folderTrees || {};
  state.loading = false;

  renderBrowserSelector();
  renderWarnings();
  renderCategories();
  renderCards();
  renderFolders();
}

function bindEvents() {
  elements.refreshButton.addEventListener('click', () => refreshBookmarks());

  elements.foldersButton.addEventListener('click', () => {
    state.folderPanelOpen = !state.folderPanelOpen;
    elements.folderPanel.hidden = !state.folderPanelOpen;
    elements.foldersButton.classList.toggle('is-active', state.folderPanelOpen);
  });

  window.bookmarkNews.onMetadataUpdated(({ url, metadata }) => {
    const bookmark = state.bookmarks.find((entry) => entry.url === url);
    if (!bookmark) {
      return;
    }

    bookmark.metadata = metadata;
    renderCards();
  });

  window.bookmarkNews.onBookmarkHidden(({ url }) => {
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.url !== url);
    if (state.selectedUrl === url) {
      state.selectedUrl = '';
    }
    renderCategories();
    renderCards();
  });

  window.bookmarkNews.onBookmarkDeleting(({ url }) => {
    const card = document.querySelector(`.bookmark-card[data-url="${CSS.escape(url)}"]`);
    if (card) {
      card.classList.add('is-deleting');
    }
  });

  window.bookmarkNews.onBookmarkDeleted(({ url }) => {
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.url !== url);
    if (state.selectedUrl === url) {
      state.selectedUrl = '';
    }
    renderCategories();
    renderCards();
  });

  window.bookmarkNews.onBookmarkFolderChanged(() => {
    refreshBookmarks();
  });
}

async function handleCreateFolder(browserId, parentPath) {
  const name = await showFolderPrompt('Folder name:', '');
  if (!name) {
    return;
  }
  try {
    await window.bookmarkNews.createFolder(browserId, parentPath, name);
    state.folderTrees = await window.bookmarkNews.listFolders();
    renderFolders();
  } catch (error) {
    console.error('Failed to create folder:', error);
    await showFolderConfirm(`Failed to create folder: ${error.message || error}\n\nMake sure the browser is closed before modifying its bookmarks.`);
  }
}

async function handleRenameFolder(browserId, folderPath, currentName) {
  const name = await showFolderPrompt('Rename folder:', currentName);
  if (!name || name === currentName) {
    return;
  }
  try {
    await window.bookmarkNews.renameFolder(browserId, folderPath, name);
    state.folderTrees = await window.bookmarkNews.listFolders();
    renderFolders();
  } catch (error) {
    console.error('Failed to rename folder:', error);
    await showFolderConfirm(`Failed to rename folder: ${error.message || error}\n\nMake sure the browser is closed before modifying its bookmarks.`);
  }
}

async function handleDeleteFolder(browserId, folderPath, folderName) {
  const confirmed = await showFolderConfirm(`Delete folder "${folderName}" and all its subfolders?`);
  if (!confirmed) {
    return;
  }
  try {
    await window.bookmarkNews.deleteFolder(browserId, folderPath);
    state.folderTrees = await window.bookmarkNews.listFolders();
    renderFolders();
  } catch (error) {
    console.error('Failed to delete folder:', error);
    await showFolderConfirm(`Failed to delete folder: ${error.message || error}\n\nMake sure the browser is closed before modifying its bookmarks.`);
  }
}

function renderFolders() {
  if (!elements.folderPanel) {
    return;
  }
  renderFolderManager(elements.folderPanel, state.folderTrees, {
    onCreate: handleCreateFolder,
    onRename: handleRenameFolder,
    onDelete: handleDeleteFolder
  });
}

async function bootstrap() {
  renderSearch();
  bindEvents();

  const initialState = await window.bookmarkNews.getInitialState();
  state.browsers = initialState.browsers;
  state.selectedBrowsers = initialState.browsers
    .filter((browser) => browser.available)
    .map((browser) => browser.id);

  renderSkeletonCards();
  await refreshBookmarks();
}

bootstrap();