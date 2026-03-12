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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookmarkNews', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  refreshBookmarks: (browserIds) => ipcRenderer.invoke('bookmarks:refresh', browserIds),
  openBookmark: (url) => ipcRenderer.invoke('bookmark:open', url),
  showBookmarkContextMenu: (url) => ipcRenderer.invoke('bookmark:show-context-menu', url),
  onMetadataUpdated: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('metadata:updated', handler);
    return () => ipcRenderer.removeListener('metadata:updated', handler);
  },
  onBookmarkHidden: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('bookmark:hidden', handler);
    return () => ipcRenderer.removeListener('bookmark:hidden', handler);
  },
  onBookmarkDeleted: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('bookmark:deleted', handler);
    return () => ipcRenderer.removeListener('bookmark:deleted', handler);
  },
  onBookmarkDeleting: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('bookmark:deleting', handler);
    return () => ipcRenderer.removeListener('bookmark:deleting', handler);
  }
});