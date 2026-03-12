# Bookmark View SE

An Electron desktop app that turns browser bookmarks into a modern, card-based news reader — with automatic metadata enrichment, full-text search, and category filters.

## Features

- **Multi-Browser Import** – Automatically detects and imports bookmarks from Chrome, Chromium, Edge, and Firefox. Duplicates are intelligently merged.
- **Metadata Enrichment** – Fetches titles, descriptions, and preview images for each bookmark in the background (7-day cache via SQLite).
- **Full-Text Search** – Search across titles, URLs, descriptions, and domains in real time.
- **Category Filters** – Two-level hierarchical filtering based on bookmark folders.
- **Sorting** – By date, name (A–Z), or domain.
- **Context Menu** – Open in browser, copy URL, hide or delete bookmarks.
- **Dark Mode** – Automatic system theme detection.
- **Responsive Layout** – Adaptive card grid with a featured card for the first bookmark.

## Screenshots

*Placeholder – add screenshots to the `assets/` folder and link them here.*

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10

## Installation

```bash
git clone <repo-url>
cd "Bookmark View SE"
npm install
```

The `postinstall` step generates app icons and rebuilds native modules (`better-sqlite3`) automatically.

## Usage

```bash
npm start
```

## Packaging

```bash
# Create a platform-specific installer
npm run make
```

Supported formats: Squirrel (Windows), DMG (macOS), DEB & RPM (Linux).

## Tech Stack

| Component | Technology |
|---|---|
| Framework | Electron 35 |
| Build Tool | Electron Forge 7 |
| Database | better-sqlite3 (metadata cache) |
| HTML Parsing | cheerio |
| HTTP Client | undici |
| Settings | electron-store |

## Project Structure

```
src/
├── main/
│   ├── main.js            # Electron main process
│   ├── metadata.js         # Metadata fetching & caching
│   ├── preload.js          # Context bridge to renderer
│   └── bookmarks/
│       ├── chrome.js       # Chromium-based import (Chrome, Edge, Chromium)
│       └── firefox.js      # Firefox import (SQLite)
└── renderer/
    ├── app.js              # Renderer logic
    ├── index.html          # Entry point
    ├── styles.css          # Styling (light/dark, glassmorphism)
    └── components/
        ├── bookmark-card.js   # Bookmark card
        ├── category-bar.js    # Category filter bar
        └── search-bar.js     # Search bar & sorting
```

## License

Apache License 2.0 – see [LICENSE.md](LICENSE.md).
