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

export function renderSearchControls(container, { searchValue, sortValue, onSearch, onSort }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'search-toolbar';

  const searchLabel = document.createElement('label');
  searchLabel.className = 'search-field';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Titel, URL oder Beschreibung durchsuchen';
  searchInput.value = searchValue;
  searchInput.autocomplete = 'off';
  searchInput.addEventListener('input', (event) => onSearch(event.target.value));
  searchLabel.appendChild(searchInput);

  const sortLabel = document.createElement('label');
  sortLabel.className = 'sort-field';
  const sortSelect = document.createElement('select');
  const options = [
    { value: 'date', label: 'Datum' },
    { value: 'name', label: 'Name A-Z' },
    { value: 'domain', label: 'Domain' }
  ];

  for (const optionConfig of options) {
    const option = document.createElement('option');
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    option.selected = optionConfig.value === sortValue;
    sortSelect.appendChild(option);
  }

  sortSelect.addEventListener('change', (event) => onSort(event.target.value));
  sortLabel.appendChild(sortSelect);

  wrapper.append(searchLabel, sortLabel);
  container.replaceChildren(wrapper);
}