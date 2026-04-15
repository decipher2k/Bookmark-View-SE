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

/**
 * folderTrees: { [browserId]: { browserName, folders: [{name, path: string[]}] } }
 * Each folder has a `path` array from the root, e.g. ["Bookmarks bar", "Tech", "JS"].
 * Root folders (path.length === 1) cannot be renamed or deleted.
 */

function buildNestedTree(flatFolders) {
  const root = { children: [] };
  const nodeByKey = new Map();
  nodeByKey.set('', root);

  for (const folder of flatFolders) {
    const parentKey = folder.path.slice(0, -1).join('\0');
    const key = folder.path.join('\0');

    const node = { name: folder.name, path: folder.path, children: [] };
    nodeByKey.set(key, node);

    const parent = nodeByKey.get(parentKey);
    if (parent) {
      parent.children.push(node);
    }
  }

  return root.children;
}

function createFolderNode(node, browserId, isRoot, { onRename, onDelete, onCreateChild }) {
  const li = document.createElement('li');
  li.className = 'folder-tree-item';

  const row = document.createElement('div');
  row.className = 'folder-tree-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'folder-tree-name';
  nameSpan.textContent = node.name;
  row.appendChild(nameSpan);

  const actions = document.createElement('div');
  actions.className = 'folder-tree-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'folder-action-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add subfolder';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onCreateChild(browserId, node.path);
  });
  actions.appendChild(addBtn);

  if (!isRoot) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'folder-action-btn';
    renameBtn.textContent = '✏';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRename(browserId, node.path, node.name);
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'folder-action-btn folder-action-btn--danger';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete(browserId, node.path, node.name);
    });
    actions.appendChild(deleteBtn);
  }

  row.appendChild(actions);
  li.appendChild(row);

  if (node.children.length > 0) {
    const childList = document.createElement('ul');
    childList.className = 'folder-tree-children';
    for (const child of node.children) {
      childList.appendChild(createFolderNode(child, browserId, false, { onRename, onDelete, onCreateChild }));
    }
    li.appendChild(childList);
  }

  return li;
}

export function renderFolderManager(container, folderTrees, { onCreate, onRename, onDelete }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-manager';

  const header = document.createElement('div');
  header.className = 'folder-manager-header';

  const title = document.createElement('h3');
  title.className = 'folder-manager-title';
  title.textContent = 'Browser Bookmark Folders';
  header.appendChild(title);

  wrapper.appendChild(header);

  const browserIds = Object.keys(folderTrees);

  if (browserIds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'folder-manager-empty';
    empty.textContent = 'No browsers detected.';
    wrapper.appendChild(empty);
  } else {
    for (const browserId of browserIds) {
      const { browserName, folders } = folderTrees[browserId];
      if (!folders || folders.length === 0) {
        continue;
      }

      const section = document.createElement('div');
      section.className = 'folder-browser-section';

      const browserLabel = document.createElement('div');
      browserLabel.className = 'folder-browser-label';
      browserLabel.textContent = browserName;
      section.appendChild(browserLabel);

      const nestedTree = buildNestedTree(folders);
      const tree = document.createElement('ul');
      tree.className = 'folder-tree';
      for (const rootNode of nestedTree) {
        tree.appendChild(createFolderNode(rootNode, browserId, true, {
          onRename,
          onDelete,
          onCreateChild: (bid, parentPath) => onCreate(bid, parentPath)
        }));
      }
      section.appendChild(tree);
      wrapper.appendChild(section);
    }
  }

  container.replaceChildren(wrapper);
}

export function showFolderPrompt(message, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'folder-prompt-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'folder-prompt-dialog';

    const label = document.createElement('label');
    label.className = 'folder-prompt-label';
    label.textContent = message;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-prompt-input';
    input.value = defaultValue || '';
    input.maxLength = 200;
    input.autocomplete = 'off';

    const btnRow = document.createElement('div');
    btnRow.className = 'folder-prompt-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'action-button-small';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'action-button-small folder-prompt-ok';
    okBtn.textContent = 'OK';

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => cleanup(null));
    okBtn.addEventListener('click', () => {
      const value = input.value.trim();
      cleanup(value || null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        cleanup(value || null);
      }
      if (e.key === 'Escape') {
        cleanup(null);
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup(null);
      }
    });

    btnRow.append(cancelBtn, okBtn);
    dialog.append(label, input, btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

export function showFolderConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'folder-prompt-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'folder-prompt-dialog';

    const label = document.createElement('p');
    label.className = 'folder-prompt-label';
    label.textContent = message;

    const btnRow = document.createElement('div');
    btnRow.className = 'folder-prompt-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'action-button-small';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'action-button-small folder-prompt-ok folder-action-btn--danger';
    okBtn.textContent = 'Delete';

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => cleanup(false));
    okBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup(false);
      }
    });

    btnRow.append(cancelBtn, okBtn);
    dialog.append(label, btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}
