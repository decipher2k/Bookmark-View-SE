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

function createChipButton(label, active, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = active ? 'chip-button is-active' : 'chip-button';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  button.appendChild(labelSpan);

  if (typeof count === 'number') {
    const countSpan = document.createElement('span');
    countSpan.className = 'chip-count';
    countSpan.textContent = String(count);
    button.appendChild(countSpan);
  }

  return button;
}

export function renderCategoryBar(container, items, activeId, onSelect) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chip-row';

  for (const item of items) {
    const button = createChipButton(item.label, item.id === activeId, item.count);
    button.dataset.categoryId = item.id;
    button.addEventListener('click', () => onSelect(item.id));
    wrapper.appendChild(button);
  }

  container.replaceChildren(wrapper);
}