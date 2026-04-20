# Gist Organizer

A Chrome extension that replaces the flat GitHub Gist list with a project-based file explorer and syntax-highlighted editor. Organize gists into projects, manage files with drag-and-drop, and edit code with full syntax highlighting — all without leaving GitHub.

## Features

### Browse & Organize
- **Project tiles** — gists displayed as a clean tile grid, grouped by description
- **File explorer layout** — left-panel file tree with a full code editor
- **Public/secret visibility** — see which projects are public or secret at a glance
- **Star projects** — click the star on any tile to star/unstar all gists in the project
- **Starred indicator** — starred projects show a gold star in the tile corner
- **Filter bar** — search by name, filter by visibility/starred/file type, collapsible
- **Works for any user** — visit any `gist.github.com/{user}` page

### Edit & Save
- **Syntax-highlighted editor** — CodeMirror with dark theme, line numbers, bracket matching
- **Markdown rendering** — `.md` files show rendered HTML by default with an Edit button
- **Inline saving** — saves directly to GitHub using the native gist form mechanism
- **Inline save status** — success/error feedback appears in the file header without shifting content
- **Unsaved changes protection** — dot indicator, confirmation prompts, browser unload warning
- **Keyboard shortcuts** — Ctrl+S to save, Escape to go back

### File & Project Management
- **Create files in-browser** — add a new empty file with "+ New file..." directly from the file panel
- **Upload files** — drag-and-drop files or use "+ Upload file..." to add existing files
- **Delete files** — remove individual files from a project via the right-click context menu
- **Create projects** — drag-and-drop a folder onto the tile grid or use "+ New Project" to create a new gist project
- **Delete projects** — remove entire projects via the right-click context menu on tiles
- **Make projects public** — convert secret gists to public from the context menu
- **Rename projects** — right-click any project tile to rename it
- **Star / Unstar** — toggle star on any project from the tile or its right-click menu

### Settings
- **Toolbar popup** — quick access to enable/disable, default visibility, and default sort order
- **Default sort order** — Name (A–Z), Last modified, or File count
- **Default visibility** — Secret or Public for newly-created projects
- **One-click disable** — turn the organizer off to see GitHub's native gist page

### Performance
- **Background preloading** — when you open a project, all file contents are preloaded in the background so switching between files is instant
- **Progress indicator** — shows file-by-file loading progress as content is fetched
- **Zero-flicker** — hides original page before it renders

## How grouping works

Each gist's **description** is used as the project name. Gists with the same description share a tile. To group gists into one project, give them the same description.

## Install

Install from the [Chrome Web Store](#) or load unpacked:

1. Clone this repo
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory

## Privacy

Gist Organizer does not collect, store, or transmit any personal data.
See the [privacy policy](https://mnlynam.github.io/gist-organizer-extension/privacy/)
(canonical source: [PRIVACY.md](PRIVACY.md)).

## Support

If you find this useful, consider [buying me a coffee](https://buymeacoffee.com/matthew81).
