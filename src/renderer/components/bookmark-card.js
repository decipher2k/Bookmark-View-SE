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

function createMetaRow(bookmark) {
  const metaRow = document.createElement('div');
  metaRow.className = 'bookmark-meta-row';

  const source = document.createElement('div');
  source.className = 'bookmark-source';

  if (bookmark.metadata.favicon) {
    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';
    favicon.src = bookmark.metadata.favicon;
    favicon.alt = '';
    favicon.loading = 'lazy';
    source.appendChild(favicon);
  }

  const domain = document.createElement('span');
  domain.textContent = bookmark.metadata.domain || bookmark.domain || 'Unknown';
  source.appendChild(domain);
  metaRow.appendChild(source);

  const browsers = document.createElement('span');
  browsers.className = 'bookmark-browsers';
  browsers.textContent = bookmark.browserNames.join(' · ');
  metaRow.appendChild(browsers);

  return metaRow;
}

export function createBookmarkCard({ bookmark, featured, selected, onSelect, onOpen, onContextMenu }) {
  const article = document.createElement('article');
  article.className = `bookmark-card${featured ? ' is-featured' : ''}${selected ? ' is-selected' : ''}`;
  article.tabIndex = 0;

  const media = document.createElement('div');
  media.className = `bookmark-media${bookmark.metadata.image ? '' : ' is-placeholder'}${bookmark.metadata.status === 'pending' ? ' is-loading' : ''}`;

  if (bookmark.metadata.image) {
    const image = document.createElement('img');
    image.src = bookmark.metadata.image;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      media.classList.add('is-placeholder');
      image.remove();
    });
    media.appendChild(image);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'bookmark-fallback-badge';
    fallback.textContent = (bookmark.metadata.domain || bookmark.domain || '?').slice(0, 2).toUpperCase();
    media.appendChild(fallback);
  }

  article.appendChild(media);

  const body = document.createElement('div');
  body.className = 'bookmark-body';

  const metaRow = createMetaRow(bookmark);
  body.appendChild(metaRow);

  const title = document.createElement('h2');
  title.className = 'bookmark-title';
  title.textContent = bookmark.metadata.title || bookmark.title;
  body.appendChild(title);

  const description = document.createElement('p');
  description.className = `bookmark-description${bookmark.metadata.status === 'pending' ? ' is-loading' : ''}`;
  description.textContent = bookmark.metadata.description || bookmark.url;
  body.appendChild(description);

  const footer = document.createElement('div');
  footer.className = 'bookmark-footer';

  const categories = document.createElement('span');
  categories.className = 'bookmark-categories';
  categories.textContent = bookmark.topLevelCategories.join(' · ');
  footer.appendChild(categories);

  if (bookmark.dateAdded) {
    const date = document.createElement('time');
    date.className = 'bookmark-date';
    date.dateTime = new Date(bookmark.dateAdded).toISOString();
    date.textContent = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(bookmark.dateAdded));
    footer.appendChild(date);
  }

  body.appendChild(footer);
  article.appendChild(body);
  article.dataset.url = bookmark.url;

  article.addEventListener('click', () => {
    onOpen(bookmark.url);
  });

  article.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    onContextMenu(bookmark.url);
  });

  article.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      onOpen(bookmark.url);
    }

    if (event.key === ' ') {
      event.preventDefault();
      onOpen(bookmark.url);
    }
  });

  return article;
}