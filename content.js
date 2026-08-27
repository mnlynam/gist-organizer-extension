// Gist Organizer v2.8.6 — Chrome Extension
// Replaces the flat GitHub Gist list with a project-based file explorer.
// https://github.com/mnlynam/gist-organizer-extension

(function () {
  var VERSION = '2.8.21';

  // Read user settings from chrome.storage.local before we touch the page.
  // We need the 'enabled' flag early to decide whether to activate at all.
  var SETTING_DEFAULTS = { enabled: true, defaultVisibility: 'secret', defaultSort: 'name' };
  var settings = Object.assign({}, SETTING_DEFAULTS);

  function loadSettings() {
    return new Promise(function(resolve) {
      if (!chrome || !chrome.storage || !chrome.storage.local) { resolve(settings); return; }
      chrome.storage.local.get(SETTING_DEFAULTS, function(s) {
        settings = Object.assign({}, SETTING_DEFAULTS, s || {});
        resolve(settings);
      });
    });
  }

  // Flipping 'enabled' requires a full reload (we can't cleanly tear down or
  // rebuild the page in place). The in-main() listener handles sort/visibility
  // changes without reloading.
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if (changes.enabled && changes.enabled.newValue !== changes.enabled.oldValue) {
        window.location.reload();
      }
    });
  }

  // hide.css (loaded via manifest at document_start) hides .application-main.
  // revealPage() makes it visible once tiles are built.
  function revealPage() {
    var appMain = document.querySelector('.application-main');
    if (appMain) appMain.style.setProperty('visibility', 'visible', 'important');
  }

  function init() {
    // If the user disabled the organizer, bail out and leave the native page
    // intact. hide.css would still be hiding .application-main, so undo that.
    if (!settings.enabled) { revealPage(); return; }

    var snippets = document.querySelectorAll('.gist-snippet');
    if (!snippets.length) { revealPage(); return; }

    snippets.forEach(function(el) { el.style.display = 'none'; });
    var sidebar = document.querySelector('#gist-pjax-container > div > div > div.h-card.col-md-3.col-12');
    if (sidebar) sidebar.style.display = 'none';
    var pageheadEarly = document.querySelector('.pagehead');
    if (pageheadEarly) pageheadEarly.style.display = 'none';

    var pathUser = window.location.pathname.replace(/^\//, '').split('/')[0];
    if (!pathUser || pathUser === 'discover' || pathUser === 'search') { revealPage(); return; }

    main(snippets, pathUser);
  }

  // Load settings first, then initialise once the DOM is ready.
  loadSettings().then(function() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  });

  function main(snippets, pathUser) {

  // --- CodeMirror mode map ---
  var MODE_MAP = {
    js: 'javascript', json: { name: 'javascript', json: true },
    html: 'htmlmixed', htm: 'htmlmixed',
    css: 'css', md: 'markdown', markdown: 'markdown',
    xml: 'xml', svg: 'xml', txt: null, bat: null, sh: null
  };
  function getMode(filename) {
    var ext = (filename.split('.').pop() || '').toLowerCase();
    return MODE_MAP[ext] !== undefined ? MODE_MAP[ext] : null;
  }

  // --- DOM helpers ---
  function getGistId(el) {
    var link = el.querySelector('.gist-snippet-meta a[href*="/"] strong.css-truncate-target');
    if (!link) return null;
    var a = link.closest('a');
    if (!a) return null;
    var parts = (a.getAttribute('href') || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  }

  function getProjectName(el) {
    var meta = el.querySelector('.gist-snippet-meta');
    if (!meta) return getFallbackName(el);
    var infoSpans = meta.querySelectorAll('.flex-order-1 span');
    for (var i = infoSpans.length - 1; i >= 0; i--) {
      var span = infoSpans[i];
      if (span.querySelector('a') || span.classList.contains('Label') || span.closest('ul')) continue;
      var text = span.textContent.trim();
      if (text && text !== 'Secret' && text !== 'Public') return text;
    }
    return getFallbackName(el);
  }

  function getFallbackName(el) {
    var fileEl = el.querySelector('strong.css-truncate-target');
    return fileEl ? fileEl.textContent.trim() : 'Untitled';
  }

  function getFileCount(el) {
    var links = el.querySelectorAll('.gist-snippet-meta ul a.Link--muted');
    if (links.length) { var m = links[0].textContent.trim().match(/\d+/); return m ? parseInt(m[0]) : 1; }
    return 1;
  }

  // Best-effort list of filenames visible on a snippet. Used by filters so
  // we can match on filename even before a project has been opened.
  function getFileNames(el) {
    var names = [];
    var fileEl = el.querySelector('.gist-snippet-meta .css-truncate-target');
    if (fileEl) names.push(fileEl.textContent.trim());
    el.querySelectorAll('.file-header .file-info a, .file-header strong, .file-info .gist-blob-name').forEach(function(n) {
      var t = n.textContent.trim();
      if (t && names.indexOf(t) === -1) names.push(t);
    });
    return names;
  }

  function getLastActive(el) {
    var time = el.querySelector('.gist-snippet-meta relative-time');
    return time ? time.textContent.trim() : '';
  }

  // Detect whether a gist snippet is Secret or Public by looking for the
  // label text that getProjectName deliberately skips.
  function getVisibility(el) {
    var meta = el.querySelector('.gist-snippet-meta');
    if (!meta) return 'secret';
    var spans = meta.querySelectorAll('.flex-order-1 span');
    for (var i = 0; i < spans.length; i++) {
      var text = spans[i].textContent.trim();
      if (text === 'Public') return 'public';
      if (text === 'Secret') return 'secret';
    }
    // Also check for a .Label element (GitHub sometimes puts it there).
    var labels = meta.querySelectorAll('.Label');
    for (var j = 0; j < labels.length; j++) {
      var lt = labels[j].textContent.trim();
      if (lt === 'Public') return 'public';
      if (lt === 'Secret') return 'secret';
    }
    return 'secret'; // default to secret if unclear
  }

  var FILE_ICONS = { js: '\uD83D\uDCDC', html: '\uD83C\uDF10', css: '\uD83C\uDFA8', md: '\uD83D\uDCDD', json: '\u2699\uFE0F', txt: '\uD83D\uDCC4', py: '\uD83D\uDC0D', rb: '\uD83D\uDC8E', sh: '\uD83D\uDCDF', bat: '\uD83D\uDCDF' };
  function fileIcon(name) { var ext = (name.split('.').pop() || '').toLowerCase(); return FILE_ICONS[ext] || '\uD83D\uDCC4'; }

  // --- Group gists by project ---
  var groups = {}, groupMeta = {}, groupGistIds = {}, groupVisibility = {};
  snippets.forEach(function(el) {
    var project = getProjectName(el);
    var gistId = getGistId(el);
    if (!groups[project]) { groups[project] = []; groupMeta[project] = { files: 0, time: '' }; groupGistIds[project] = []; groupVisibility[project] = 'secret'; }
    groups[project].push(el);
    groupMeta[project].files += getFileCount(el);
    if (!groupMeta[project].time) groupMeta[project].time = getLastActive(el);
    if (gistId) groupGistIds[project].push(gistId);
    // If any gist in the group is public, the project is public.
    if (getVisibility(el) === 'public') groupVisibility[project] = 'public';
  });
  // Compare function driven by the user's defaultSort setting. Name is the
  // stable fallback when two items tie on the primary key.
  function projectCompare(a, b) {
    if (settings.defaultSort === 'files') {
      var fa = (groupMeta[a] && groupMeta[a].files) || 0;
      var fb = (groupMeta[b] && groupMeta[b].files) || 0;
      if (fa !== fb) return fb - fa;
    } else if (settings.defaultSort === 'recent') {
      var ta = (groupMeta[a] && groupMeta[a].time) || '';
      var tb = (groupMeta[b] && groupMeta[b].time) || '';
      if (ta !== tb) return tb.localeCompare(ta);
    }
    return a.localeCompare(b);
  }
  var sortedKeys = Object.keys(groups).sort(projectCompare);

  // --- Replace page content ---
  var contentCol = document.querySelector('.col-9.col-md-9.col-12');
  if (contentCol) { contentCol.classList.remove('col-9', 'col-md-9'); contentCol.classList.add('col-12'); }
  var container = snippets[0].parentElement;
  snippets.forEach(function(el) { el.remove(); });
  var paginate = container.querySelector('.paginate-container');
  if (paginate) paginate.style.display = 'none';

  // --- Styles ---
  var style = document.createElement('style');
  style.textContent = [
    '.go-wrapper { display: flex; gap: 0; min-height: 70vh; }',
    '.go-left { width: 240px; flex-shrink: 0; border-right: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-muted, #161b22); display: none; border-radius: 8px 0 0 8px; overflow-y: auto; }',
    '.go-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }',
    '.go-container { border: 1px solid var(--borderColor-default, #30363d); border-radius: 8px; overflow: hidden; margin-bottom: 24px; }',
    '.go-container.has-left .go-left { display: block; }',

    // Tiles
    '.go-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; padding: 20px; }',
    '.go-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: var(--bgColor-default, #0d1117); border: 1px solid var(--borderColor-default, #30363d); border-radius: 10px; cursor: pointer; user-select: none; transition: all 0.15s; padding: 24px 12px 16px; text-align: center; }',
    '.go-tile:hover { border-color: var(--borderColor-accent-emphasis, #1f6feb); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }',
    '.go-tile .tile-icon { font-size: 32px; line-height: 1; }',
    '.go-tile .tile-name { font-weight: 600; font-size: 12px; color: var(--fgColor-default, #e6edf3); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding: 1px 4px; border-radius: 3px; }',
    '.go-tile .tile-name.editing { display: block; -webkit-line-clamp: unset; overflow: visible; white-space: normal; word-break: break-word; background: var(--bgColor-default, #0d1117); outline: 2px solid var(--borderColor-accent-emphasis, #1f6feb); cursor: text; user-select: text; }',
    '.go-tile .tile-name.saving { opacity: 0.5; }',
    '.go-tile .tile-meta { font-size: 10px; color: var(--fgColor-muted, #7d8590); }',
    '.go-tile-archive { background: var(--bgColor-muted, #161b22); border-color: var(--borderColor-muted, #484f58); }',
    '.go-tile-archive .tile-icon { opacity: 0.85; }',
    '.go-tile-archive .tile-name { color: var(--fgColor-muted, #7d8590); }',
    '.go-tile-add { border-style: dashed; opacity: 0.6; }',
    '.go-tile-add:hover { opacity: 1; }',
    '.go-tile-add .tile-icon { font-size: 28px; color: var(--fgColor-accent, #4493f8); }',
    '.go-tile .tile-star { position: absolute; top: 6px; right: 8px; font-size: 16px; line-height: 1; padding: 4px; border-radius: 4px; cursor: pointer; background: transparent; border: none; color: var(--fgColor-muted, #7d8590); opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s; }',
    '.go-tile:hover .tile-star { opacity: 1; }',
    '.go-tile .tile-star.starred { opacity: 1; color: #d4a72c; text-shadow: 0 1px 2px rgba(0,0,0,0.4); }',
    '.go-tile .tile-star:hover { background: var(--bgColor-neutral-muted, rgba(110,118,129,0.2)); color: #d4a72c; }',
    '.go-tiles.drag-over { outline: 2px dashed var(--borderColor-accent-emphasis, #1f6feb); outline-offset: -2px; border-radius: 8px; background: var(--bgColor-accent-muted, #121d2f); }',
    '.go-empty { grid-column: 1 / -1; padding: 40px 20px; text-align: center; font-size: 13px; color: var(--fgColor-muted, #7d8590); }',

    // Filter bar
    '.go-filter-bar { padding: 12px 20px 0; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid var(--borderColor-default, #30363d); }',
    '.go-filter-bar.collapsed { padding-bottom: 12px; }',
    '.go-filter-bar.collapsed .go-filter-controls { display: none; }',
    '.go-filter-toggle { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--fgColor-muted, #7d8590); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; padding: 0; align-self: flex-start; }',
    '.go-filter-toggle:hover { color: var(--fgColor-default, #e6edf3); }',
    '.go-filter-chev { display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; transition: transform 0.15s; }',
    '.go-filter-bar.collapsed .go-filter-chev { transform: rotate(-90deg); }',
    '.go-filter-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-bottom: 12px; }',
    '.go-filter-search { flex: 1; min-width: 180px; }',
    '.go-filter-search input { width: 100%; padding: 6px 10px; font-size: 13px; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); border: 1px solid var(--borderColor-default, #30363d); border-radius: 6px; outline: none; }',
    '.go-filter-search input:focus { border-color: var(--borderColor-accent-emphasis, #1f6feb); }',
    '.go-filter-select { padding: 6px 28px 6px 10px; font-size: 13px; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); border: 1px solid var(--borderColor-default, #30363d); border-radius: 6px; cursor: pointer; outline: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'none\' stroke=\'%237d8590\' stroke-width=\'1.5\' stroke-linecap=\'round\' d=\'M1 1l4 4 4-4\'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; }',
    '.go-file-filter { display: block; margin: 8px 16px; width: calc(100% - 32px); box-sizing: border-box; font-size: 12px; padding: 5px 26px 5px 8px; }',
    '.go-filter-star { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; user-select: none; color: var(--fgColor-default, #e6edf3); padding: 6px 10px; background: var(--bgColor-default, #0d1117); border: 1px solid var(--borderColor-default, #30363d); border-radius: 6px; }',
    '.go-filter-star input { margin: 0; }',
    '.go-filter-star-glyph { color: #d4a72c; }',
    '.go-filter-clear { padding: 6px 12px; font-size: 12px; background: transparent; color: var(--fgColor-muted, #7d8590); border: 1px solid transparent; border-radius: 6px; cursor: pointer; }',
    '.go-filter-clear:hover { color: var(--fgColor-default, #e6edf3); border-color: var(--borderColor-default, #30363d); }',

    // Footer
    '.go-footer { padding: 12px 20px; text-align: center; font-size: 11px; color: var(--fgColor-muted, #7d8590); border-top: 1px solid var(--borderColor-default, #30363d); }',

    // Left panel
    '.go-project-tile { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--borderColor-default, #30363d); cursor: pointer; }',
    '.go-project-tile:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-project-tile:hover .pt-icon { background: var(--bgColor-default, #0d1117); border-color: var(--borderColor-muted, #484f58); color: var(--fgColor-default, #e6edf3); }',
    '.go-project-tile .pt-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-muted, #161b22); color: var(--fgColor-muted, #7d8590); font-size: 14px; line-height: 1; flex-shrink: 0; transition: all 0.15s; }',
    '.go-project-tile .pt-icon svg { display: block; }',
    '.go-project-tile .pt-name { font-weight: 600; font-size: 13px; color: var(--fgColor-default, #e6edf3); }',
    '.go-project-tile .pt-meta { font-size: 11px; color: var(--fgColor-muted, #7d8590); }',
    '.go-file-nav { list-style: none; margin: 0; padding: 0; }',
    '.go-file-nav li { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; color: var(--fgColor-default, #e6edf3); border-left: 2px solid transparent; }',
    '.go-file-nav li:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-file-nav li.active { border-left-color: var(--borderColor-accent-emphasis, #1f6feb); background: var(--bgColor-accent-muted, #121d2f); color: var(--fgColor-accent, #4493f8); }',
    '.go-file-nav li .fn-icon { font-size: 14px; flex-shrink: 0; }',
    '.go-file-nav li .fn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 4px; border-radius: 3px; }',
    '.go-file-nav li.active .fn-name { cursor: text; }',
    '.go-file-nav li .fn-name.editing { overflow: visible; text-overflow: clip; white-space: normal; word-break: break-all; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); outline: 2px solid var(--borderColor-accent-emphasis, #1f6feb); user-select: text; }',
    '.go-file-nav li .fn-name.saving { opacity: 0.5; }',
    '.go-file-nav li .fn-hint { font-size: 11px; color: var(--fgColor-muted, #7d8590); flex-shrink: 0; }',
    '.go-file-nav li .fn-modified { width: 6px; height: 6px; border-radius: 50%; background: #d29922; margin-left: auto; flex-shrink: 0; }',

    // Preload progress bar (bottom of left panel)
    '.go-preload { padding: 10px 16px; border-top: 1px solid var(--borderColor-default, #30363d); margin-top: auto; }',
    '.go-preload-track { height: 3px; background: var(--bgColor-neutral-muted, #1c2128); border-radius: 2px; overflow: hidden; }',
    '.go-preload-fill { height: 100%; width: 0; background: var(--borderColor-accent-emphasis, #1f6feb); border-radius: 2px; transition: width 0.3s ease; }',
    '.go-preload-fill.done { background: var(--fgColor-success, #3fb950); }',
    '.go-preload-text { font-size: 11px; color: var(--fgColor-muted, #7d8590); margin-top: 5px; }',

    // Add-file row (left panel)
    '.go-add-file { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; color: var(--fgColor-accent, #4493f8); border-bottom: 1px solid var(--borderColor-default, #30363d); user-select: none; }',
    '.go-add-file:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-add-file .fn-icon { font-size: 16px; width: 14px; text-align: center; flex-shrink: 0; }',

    // Drop target highlight (while dragging files over the left panel)
    '.go-left.drag-over { background: var(--bgColor-accent-muted, #121d2f); outline: 2px dashed var(--borderColor-accent-emphasis, #1f6feb); outline-offset: -2px; }',

    // Context menu
    '.go-context-menu { position: fixed; background: var(--overlay-bgColor, #161b22); border: 1px solid var(--borderColor-default, #30363d); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); padding: 4px; z-index: 10000; min-width: 160px; font-size: 13px; }',
    '.go-context-menu-item { padding: 6px 12px; border-radius: 4px; cursor: pointer; color: var(--fgColor-default, #e6edf3); user-select: none; }',
    '.go-context-menu-item:hover { background: var(--bgColor-accent-emphasis, #1f6feb); color: #fff; }',
    '.go-context-menu-item.danger { color: var(--fgColor-danger, #f85149); }',
    '.go-context-menu-item.danger:hover { background: var(--bgColor-danger-emphasis, #da3633); color: #fff; }',
    '.go-context-menu-separator { height: 1px; background: var(--borderColor-default, #30363d); margin: 4px 0; }',
    '.go-context-menu-item.split { cursor: default; }',
    '.go-context-menu-item.split:hover { background: transparent; color: var(--fgColor-default, #e6edf3); }',
    '.go-context-link { color: var(--fgColor-accent, #4493f8); cursor: pointer; }',
    '.go-context-link:hover { text-decoration: underline; }',

    // Content header
    '.go-content-header { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--bgColor-muted, #161b22); border-bottom: 1px solid var(--borderColor-default, #30363d); flex-shrink: 0; }',
    '.go-content-header .ch-name { font-weight: 600; font-size: 14px; color: var(--fgColor-default, #e6edf3); flex-shrink: 0; }',
    '.go-content-header .ch-modified { color: #d29922; margin-left: 6px; }',
    '.go-content-header .ch-status { flex: 1; min-width: 0; margin: 0 12px; font-size: 12px; opacity: 0; transition: opacity 0.2s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.go-content-header .ch-status.visible { opacity: 1; }',
    '.go-content-header .ch-status.success { color: #3fb950; }',
    '.go-content-header .ch-status.error { color: #f85149; }',
    '.go-content-header .ch-actions { display: flex; gap: 8px; flex-shrink: 0; }',
    '.go-btn { padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); transition: all 0.15s; }',
    '.go-btn:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-btn-primary { background: #238636; border-color: #238636; color: #fff; }',
    '.go-btn-primary:hover { background: #2ea043; }',
    '.go-btn-primary:disabled { opacity: 0.5; cursor: default; }',
    '.go-btn-split { display: inline-flex; }',
    '.go-btn-split .go-btn-split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: none; }',
    '.go-btn-split .go-btn-split-chev { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 5px 8px; }',

    // Editor
    '.go-editor-area { flex: 1; overflow: auto; }',
    '.go-loading { padding: 40px; text-align: center; color: var(--fgColor-muted, #7d8590); font-size: 13px; }',
    '.go-status { padding: 8px 16px; font-size: 12px; text-align: center; flex-shrink: 0; }',
    '.go-status.success { background: #1a3a2a; color: #3fb950; }',
    '.go-status.error { background: #3a1a1a; color: #f85149; }',

    // Rendered markdown view
    '.go-rendered { flex: 1; overflow: auto; padding: 24px 32px; }',
    '.go-rendered .markdown-body { font-size: 14px; line-height: 1.6; }',

    // CodeMirror overrides
    '.go-cm-wrap { flex: 1; display: flex; flex-direction: column; }',
    '.go-cm-wrap .CodeMirror { flex: 1; height: auto; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.45; border: none; }',
    '.go-cm-wrap .CodeMirror-gutters { border-right: 1px solid var(--borderColor-muted, #21262d); }',
    '.go-cm-wrap .CodeMirror-linenumber { padding: 0 8px 0 12px; min-width: 28px; }',

    // Textarea fallback
    '.go-editor { width: 100%; flex: 1; padding: 12px 16px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.5; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); border: none; resize: none; outline: none; tab-size: 2; }',

    // Responsive
    '@media (max-width: 600px) { .go-tiles { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 12px; } .go-filter-bar { padding: 10px 12px 0; } .go-filter-controls { gap: 6px; } .go-filter-search { min-width: 120px; } .go-left { width: 200px; } .go-rendered { padding: 16px; } }',
    '@media (min-width: 1400px) { .go-tiles { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } }'
  ].join('\n');
  document.head.appendChild(style);

  // --- Build layout ---
  var outerContainer = document.createElement('div');
  outerContainer.className = 'go-container';
  var wrapper = document.createElement('div');
  wrapper.className = 'go-wrapper';
  var leftPanel = document.createElement('div');
  leftPanel.className = 'go-left';
  var mainPanel = document.createElement('div');
  mainPanel.className = 'go-main';
  wrapper.appendChild(leftPanel);
  wrapper.appendChild(mainPanel);
  outerContainer.appendChild(wrapper);
  container.appendChild(outerContainer);

  // Drag-drop files onto the left panel to add them to the open project.
  // Bound once at layout time and gated on activeProject so it's a no-op while
  // viewing the tile grid. dragleave has to check the target because moving
  // between child elements fires leave events even though the drag is still
  // over the panel.
  leftPanel.addEventListener('dragover', function(e) {
    if (!activeProject) return;
    var types = e.dataTransfer && e.dataTransfer.types;
    var hasFiles = false;
    if (types) {
      for (var i = 0; i < types.length; i++) { if (types[i] === 'Files') { hasFiles = true; break; } }
    }
    if (!hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    leftPanel.classList.add('drag-over');
  });
  leftPanel.addEventListener('dragleave', function(e) {
    // relatedTarget is the element the cursor moved into; if it's still inside
    // the panel we're still dragging over the panel.
    if (!e.relatedTarget || !leftPanel.contains(e.relatedTarget)) {
      leftPanel.classList.remove('drag-over');
    }
  });
  leftPanel.addEventListener('drop', function(e) {
    if (!activeProject) return;
    e.preventDefault();
    leftPanel.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleAddFiles(e.dataTransfer.files);
    }
  });

  // --- State ---
  var fileCache = {};
  var rawCache = {};
  var editPageCache = {};
  var activeProject = null;
  var activeFile = null;
  var cmInstance = null;
  var hasUnsavedChanges = false;
  var preloadState = null; // { project, total, loaded, el } — active while preloading
  var starredGistIds = {}; // gistId -> true, populated async from /{user}/starred
  var starredLoaded = false;
  var projectFileExt = 'all'; // per-project file-type filter, reset on project open/close

  // Filter state persists per-origin so a return visit keeps the same view.
  var FILTER_STORAGE_KEY = 'gistOrganizer.filters.v1';
  var filterState = loadFilterState();

  // Description used to identify the gist that holds archived files. The
  // extension creates this gist on first archive and recognizes it across
  // sessions by description match.
  var ARCHIVE_DESCRIPTION = 'Gist Organizer Archive';

  function loadFilterState() {
    var defaults = { collapsed: false, search: '', visibility: 'all', starred: false, showArchived: false };
    try {
      var raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return defaults;
      return Object.assign({}, defaults, JSON.parse(raw) || {});
    } catch (e) { return defaults; }
  }
  function persistFilterState() {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filterState)); } catch (e) {}
  }

  // --- Unsaved changes guard ---
  function confirmDiscard() {
    if (!hasUnsavedChanges) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  // Warn on page unload
  window.addEventListener('beforeunload', function(e) {
    if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  // Scrape the user's /starred page for gist IDs. Gracefully no-ops on failure
  // (e.g., logged-out users or empty starred list) — the star filter just
  // stays empty. Triggers a re-render if the filter UI is already mounted.
  function fetchStarredGists() {
    if (starredLoaded) return;
    starredLoaded = true;
    fetch('/' + pathUser + '/starred', { credentials: 'include' })
      .then(function(res) { return res.ok ? res.text() : ''; })
      .then(function(html) {
        if (!html) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('.gist-snippet').forEach(function(el) {
          var id = getGistId(el);
          if (id) starredGistIds[id] = true;
        });
        if (typeof rerenderTiles === 'function' && !activeProject) rerenderTiles();
      })
      .catch(function() {});
  }

  // True if any gist in the project is in the starred set.
  function isProjectStarred(project) {
    var ids = groupGistIds[project] || [];
    for (var i = 0; i < ids.length; i++) { if (starredGistIds[ids[i]]) return true; }
    return false;
  }

  // Unique file extensions in a single opened project. Drives the file-type
  // filter shown in the left panel.
  function collectProjectExtensions(project) {
    var exts = {};
    var files = fileCache[project] || [];
    files.forEach(function(f) {
      var dot = f.name.lastIndexOf('.');
      if (dot > 0) exts[f.name.substring(dot + 1).toLowerCase()] = true;
    });
    return Object.keys(exts).sort();
  }

  // Apply current filters to the sorted project list. Search matches project
  // name OR any known filename within the project.
  function filteredProjects() {
    var q = (filterState.search || '').trim().toLowerCase();
    return sortedKeys.filter(function(project) {
      if (project === ARCHIVE_DESCRIPTION && !filterState.showArchived) return false;
      if (filterState.visibility === 'public' && groupVisibility[project] !== 'public') return false;
      if (filterState.visibility === 'secret' && groupVisibility[project] === 'public') return false;
      if (filterState.starred && !isProjectStarred(project)) return false;
      if (q) {
        if (project.toLowerCase().indexOf(q) !== -1) return true;
        var files = fileCache[project];
        if (files && files.some(function(f) { return f.name.toLowerCase().indexOf(q) !== -1; })) return true;
        var snippets = groups[project] || [];
        for (var i = 0; i < snippets.length; i++) {
          var names = getFileNames(snippets[i]) || [];
          if (names.some(function(n) { return n.toLowerCase().indexOf(q) !== -1; })) return true;
        }
        return false;
      }
      return true;
    });
  }

  // Placeholder; overwritten by renderBrowse after it builds the grid.
  var rerenderTiles = null;

  // Live-apply sort/visibility changes from the popup without reloading.
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if (changes.defaultSort && changes.defaultSort.newValue !== settings.defaultSort) {
        settings.defaultSort = changes.defaultSort.newValue;
        sortedKeys.sort(projectCompare);
        if (rerenderTiles && !activeProject) rerenderTiles();
      }
      if (changes.defaultVisibility) {
        settings.defaultVisibility = changes.defaultVisibility.newValue;
      }
    });
  }

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeProject) {
      if (confirmDiscard()) renderBrowse();
    }
  });

  // --- Fetch helpers ---
  function fetchGistFiles(gistId, opts) {
    // For read-after-write verification we append a timestamp to bypass any
    // browser/CDN caching that would otherwise return the pre-write page.
    var url = '/' + pathUser + '/' + gistId + (opts && opts.fresh ? '?_=' + Date.now() : '');
    return fetch(url, { credentials: 'include' })
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var files = [];
        doc.querySelectorAll('.file').forEach(function(f) {
          var nameEl = f.querySelector('.file-header .file-info a') || f.querySelector('.file-header a[href*="#file"]') || f.querySelector('.file-header .file-info strong') || f.querySelector('.file-header strong');
          if (nameEl) {
            var name = nameEl.textContent.trim();
            // Try code lines first (works for JS, HTML, CSS, etc.)
            var codeLines = f.querySelectorAll('.blob-code-inner, .js-file-line');
            var rawText = '';
            if (codeLines.length) {
              rawText = Array.from(codeLines).map(function(line) { return line.textContent.replace(/\n$/, ''); }).join('\n');
            }
            // For rendered files (markdown), capture the rendered HTML
            var renderedHtml = '';
            if (!rawText) {
              var renderedBody = f.querySelector('.markdown-body');
              if (renderedBody) renderedHtml = renderedBody.outerHTML;
            }
            // Capture raw URL from file header
            var rawLink = f.querySelector('.file-header a[href*="/raw/"]');
            var rawUrl = rawLink ? rawLink.getAttribute('href') : null;
            files.push({
              name: name,
              gistId: gistId,
              rawText: rawText,
              rawUrl: rawUrl,
              renderedHtml: renderedHtml
            });
          }
        });
        return files;
      });
  }

  function fetchRawContent(gistId, filename) {
    var key = gistId + ':' + filename;
    if (rawCache[key]) return Promise.resolve(rawCache[key]);

    // Check if we have extracted raw text from code lines
    var rawUrl = null;
    for (var p in fileCache) {
      if (fileCache[p]) {
        var match = fileCache[p].find(function(f) { return f.gistId === gistId && f.name === filename; });
        if (match) {
          if (match.rawText) { rawCache[key] = match.rawText; return Promise.resolve(match.rawText); }
          if (match.rawUrl) rawUrl = match.rawUrl;
        }
      }
    }

    // Fallback: fetch the edit page (has raw content for files whose
    // server-rendered textareas are populated).
    return fetchEditPageData(gistId).then(function(editData) {
      if (editData.fileContents && editData.fileContents[filename] !== undefined) {
        rawCache[key] = editData.fileContents[filename];
        return editData.fileContents[filename];
      }
      // Final fallback: fetch the raw URL scraped from the gist view page.
      // Markdown files often have empty edit-page textareas (preview mode) but
      // still have a working /raw/ URL.
      if (rawUrl) {
        return fetch(rawUrl, { credentials: 'include' }).then(function(res) {
          if (!res.ok) throw new Error('Raw fetch failed (HTTP ' + res.status + ') for ' + filename);
          return res.text();
        }).then(function(text) {
          rawCache[key] = text;
          return text;
        });
      }
      throw new Error('Content not found for ' + filename);
    });
  }

  // --- Native GitHub save ---
  function fetchEditPageData(gistId) {
    if (editPageCache[gistId]) return Promise.resolve(editPageCache[gistId]);
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var csrf = '';
        var csrfEl = doc.querySelector('input[name="authenticity_token"]');
        if (csrfEl) csrf = csrfEl.value;
        var descEl = doc.querySelector('input[name="gist[description]"], textarea[name="gist[description]"]');
        var description = descEl ? descEl.value : '';
        var fileOids = {};
        var fileContents = {};
        // Walk every form element in document order and group by oid anchor.
        // This keeps per-file name/value association correct even when some
        // files are missing a textarea in the server-rendered HTML.
        var allForms = doc.querySelectorAll('form');
        var editForm = null;
        for (var fj = 0; fj < allForms.length; fj++) {
          if (allForms[fj].querySelector('input[name="gist[contents][][oid]"]')) {
            editForm = allForms[fj];
            break;
          }
        }
        if (editForm) {
          var curTrip = null;
          var walkEls = editForm.querySelectorAll('input, textarea');
          for (var wi = 0; wi < walkEls.length; wi++) {
            var wel = walkEls[wi];
            var wn = wel.getAttribute('name');
            if (wn === 'gist[contents][][oid]') {
              curTrip = { oid: wel.value, name: null };
            } else if (curTrip && wn === 'gist[contents][][name]' && curTrip.name === null) {
              curTrip.name = wel.value;
              fileOids[curTrip.name] = curTrip.oid;
            } else if (curTrip && wn === 'gist[contents][][value]' && curTrip.name !== null) {
              if (wel.value) fileContents[curTrip.name] = wel.value;
            }
          }
        }
        var data = { csrf: csrf, description: description, fileOids: fileOids, fileContents: fileContents };
        editPageCache[gistId] = data;
        return data;
      });
  }

  // Read a form element's submit value defensively. DOMParser-created documents
  // have a quirk: setting `.value` on a <textarea> does not reliably update the
  // value read back later, and in some cases the initial `.value` is empty even
  // when the parsed textarea has child text. Fall back to defaultValue (the
  // parsed initial text) or textContent if `.value` looks empty.
  function readElementValue(el) {
    var v = el.value;
    if (el.tagName === 'TEXTAREA') {
      if (v === undefined || v === null || v === '') {
        if (el.defaultValue !== undefined && el.defaultValue !== '') return el.defaultValue;
        return el.textContent || '';
      }
    }
    return v;
  }

  // Serialize a <form> into a URL-encoded body, optionally substituting a new
  // value for one specific element (by identity). This is used instead of
  // mutating the parsed textarea in place, because setting textarea.value on a
  // DOMParser document does not reliably round-trip — which caused silent "save
  // succeeded, nothing changed" bugs where the original content was submitted.
  //
  // opts (optional):
  //   skipEls: Array of element references to omit from serialization. Used to
  //     remove a whole file record on delete (name + oid + value must ALL be
  //     dropped together, otherwise Rails' bare-[] array parser misgroups the
  //     remaining fields).
  //   extraFields: Array of {name, value} pairs to append at the end of the
  //     body. Used to add a new file entry without an oid — Rails starts a new
  //     group whenever it sees a key that was already filled in the current
  //     group, so appending name+value with no oid becomes a new file record.
  //   valueOverrides: Map<Element, string> for substituting MULTIPLE elements
  //     at once. Used by saveFile() to fill in the content of every file in
  //     the gist (not just the one being saved) — markdown files render as
  //     preview by default and their textareas are empty in the parsed HTML,
  //     so without overrides they'd submit blank and Rails would 422.
  function buildFormBody(form, overrideEl, overrideValue, opts) {
    opts = opts || {};
    var skipEls = opts.skipEls || null;
    var extraFields = opts.extraFields || null;
    var valueOverrides = opts.valueOverrides || null;
    var parts = [];
    var elements = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (skipEls && skipEls.indexOf(el) !== -1) continue;
      var name = el.getAttribute('name');
      if (!name || el.disabled) continue;
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' ||
          type === 'image' || type === 'file') continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      var value;
      if (el === overrideEl) {
        value = overrideValue;
      } else if (valueOverrides && valueOverrides.has(el)) {
        value = valueOverrides.get(el);
      } else {
        value = readElementValue(el);
      }
      if (value === undefined || value === null) continue;
      parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
    }
    if (extraFields) {
      for (var k = 0; k < extraFields.length; k++) {
        var f = extraFields[k];
        parts.push(encodeURIComponent(f.name) + '=' + encodeURIComponent(f.value));
      }
    }
    return parts.join('&');
  }

  function saveFile(gistId, filename, content) {
    // Before fetching the edit page, make sure rawCache has the content for
    // EVERY file in this gist. The edit-page form leaves some textareas blank
    // (notably markdown files in preview mode) — if we serialize those as
    // empty, Rails 422s the whole save. We need cached content to override
    // them at serialization time.
    var siblingFiles = (fileCache[activeProject] || []).filter(function(f) {
      return f.gistId === gistId && f.name !== filename;
    });
    var missing = siblingFiles.filter(function(f) {
      return rawCache[gistId + ':' + f.name] === undefined;
    });
    var prep = missing.length
      ? Promise.all(missing.map(function(f) { return fetchRawContent(gistId, f.name); }))
      : Promise.resolve();

    // Always fetch the edit page fresh on save. The page gives us a live <form>
    // with the current CSRF token and oids; reusing cached data risks sending
    // stale oids (the gist may have been edited in another tab) which GitHub
    // rejects with 422.
    return prep.then(function() {
      return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' });
    })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        // Find the gist edit form — the one that contains the hidden oid inputs.
        // We prefer this over matching by action URL or form class because those
        // are more likely to change than the presence of this hidden field.
        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('input[name="gist[contents][][oid]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Edit form not found on page');

        // Group the form's per-file inputs into triples anchored on the oid
        // input. We CANNOT pair name inputs with value textareas by
        // querySelectorAll index — some files (e.g., markdown in preview mode)
        // have their textarea missing from the parsed HTML, which misaligns
        // the two lists and causes saves to overwrite the wrong file.
        // Instead, walk form elements in document order and attach each
        // subsequent name/value input to the most recent oid.
        var fileTriples = [];
        var current = null;
        var formEls = form.querySelectorAll('input, textarea');
        for (var fi = 0; fi < formEls.length; fi++) {
          var fel = formEls[fi];
          var fn = fel.getAttribute('name');
          if (fn === 'gist[contents][][oid]') {
            if (current) fileTriples.push(current);
            current = { oid: fel, nameInput: null, valueTa: null };
          } else if (current && fn === 'gist[contents][][name]' && !current.nameInput) {
            current.nameInput = fel;
          } else if (current && fn === 'gist[contents][][value]' && !current.valueTa) {
            current.valueTa = fel;
          }
        }
        if (current) fileTriples.push(current);

        // Resolve each file: target gets the new content; others get cached
        // raw content (needed because Rails 422s on empty file values, and
        // markdown textareas are often empty in the parsed HTML).
        var target = null;
        var valueOverrides = new Map();
        for (var ti = 0; ti < fileTriples.length; ti++) {
          var trip = fileTriples[ti];
          if (!trip.nameInput || !trip.valueTa) continue;
          var fname = trip.nameInput.value;
          if (fname === filename) {
            target = trip.valueTa;
          } else {
            var cached = rawCache[gistId + ':' + fname];
            if (cached === undefined) {
              // Refuse to save: submitting an empty textarea would either 422
              // or blank the file. Better to fail loudly than silently corrupt.
              throw new Error('Cannot save: content for sibling file "' + fname + '" is not cached. Open that file first, then try again.');
            }
            valueOverrides.set(trip.valueTa, cached);
          }
        }
        if (!target) throw new Error('Could not locate editor for ' + filename + ' in edit form');

        // Substitute the new content at serialization time rather than mutating
        // the parsed DOM — see readElementValue() and buildFormBody() for why.
        var body = buildFormBody(form, target, content, { valueOverrides: valueOverrides });
        var action = form.getAttribute('action') || ('/' + pathUser + '/' + gistId);

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        rawCache[gistId + ':' + filename] = content;
        // Update the cached file object in place so the left panel and any
        // subsequent reads stay consistent with the just-saved content. We used
        // to `delete fileCache[activeProject]` here, which blanked the file list
        // as soon as the user clicked another file after saving.
        if (fileCache[activeProject]) {
          fileCache[activeProject].forEach(function(f) {
            if (f.gistId === gistId && f.name === filename) {
              f.rawText = content;
            }
          });
        }
        delete editPageCache[gistId];
      });
  }

  // Update a gist's description via the same edit-form replay path as saveFile.
  // Used to rename projects: the project name is derived from the description,
  // so renaming a project means POSTing a new description for every gist in the
  // group.
  function saveGistDescription(gistId, newDescription) {
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('input[name="gist[contents][][oid]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Edit form not found on page');

        var descEl = form.querySelector('input[name="gist[description]"], textarea[name="gist[description]"]');
        if (!descEl) throw new Error('Description field not found');

        var body = buildFormBody(form, descEl, newDescription);
        var action = form.getAttribute('action') || ('/' + pathUser + '/' + gistId);

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // Rename a file inside a gist via the same edit-form replay path. Matches
  // the current filename input by value, overrides it with the new filename,
  // and POSTs the whole form. GitHub treats a changed name + unchanged oid as
  // a rename.
  function saveGistFilename(gistId, oldFilename, newFilename) {
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('input[name="gist[contents][][oid]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Edit form not found on page');

        var nameInputs = form.querySelectorAll('input[name="gist[contents][][name]"]');
        var target = null;
        for (var j = 0; j < nameInputs.length; j++) {
          if (nameInputs[j].value === oldFilename) {
            target = nameInputs[j];
            break;
          }
        }
        if (!target && nameInputs.length === 1) target = nameInputs[0];
        if (!target) throw new Error('Could not locate filename input for ' + oldFilename);

        var body = buildFormBody(form, target, newFilename);
        var action = form.getAttribute('action') || ('/' + pathUser + '/' + gistId);

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // Append a new file to an existing gist via the same edit-form replay path.
  // The appended file has no oid, which GitHub/Rails treats as "create new".
  // Extra fields are added at the END of the body so Rails' array-param parser
  // sees them as a brand-new record (it starts a new group whenever a bare-[]
  // key is repeated within the current group).
  function addFileToGist(gistId, filename, content) {
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('input[name="gist[contents][][oid]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Edit form not found on page');

        var body = buildFormBody(form, null, null, {
          extraFields: [
            { name: 'gist[contents][][name]', value: filename },
            { name: 'gist[contents][][value]', value: content }
          ]
        });
        var action = form.getAttribute('action') || ('/' + pathUser + '/' + gistId);

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // Read a File (from drag-drop or <input type=file>) as UTF-8 text.
  function readFileAsText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error || new Error('FileReader failed')); };
      reader.readAsText(file);
    });
  }

  // --- Folder reading helpers (for drag-drop + browse folder upload) ---

  // Read a single FileSystemFileEntry (from webkitGetAsEntry) and return an
  // array with one {name, content} object. Returns an array for consistency
  // with readDirectoryEntries so they can be Promise.all'd and flattened.
  function readFileEntry(entry) {
    return new Promise(function(resolve, reject) {
      entry.file(function(file) {
        readFileAsText(file).then(function(content) {
          resolve([{ name: file.name, content: content }]);
        }).catch(reject);
      }, reject);
    });
  }

  // Recursively read all files in a FileSystemDirectoryEntry. Returns a flat
  // array of {name, content} objects. Subdirectory files get flattened (no
  // path nesting) because gists are flat file lists.
  function readDirectoryEntries(dirEntry) {
    return new Promise(function(resolve, reject) {
      var reader = dirEntry.createReader();
      var allEntries = [];
      // readEntries returns results in batches — keep calling until empty.
      function readBatch() {
        reader.readEntries(function(batch) {
          if (!batch.length) {
            var promises = allEntries.map(function(e) {
              if (e.isFile) return readFileEntry(e);
              if (e.isDirectory) return readDirectoryEntries(e);
              return Promise.resolve([]);
            });
            Promise.all(promises).then(function(results) {
              var files = [];
              results.forEach(function(r) { files = files.concat(r); });
              resolve(files);
            }).catch(reject);
          } else {
            allEntries = allEntries.concat(Array.prototype.slice.call(batch));
            readBatch();
          }
        }, reject);
      }
      readBatch();
    });
  }

  // Process a DataTransferItemList from a drop event. Detects directories via
  // webkitGetAsEntry, reads their contents, and returns { folderName, files }.
  function readDroppedItems(items) {
    var entries = [];
    var folderName = null;
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) {
        if (entry.isDirectory && !folderName) folderName = entry.name;
        entries.push(entry);
      }
    }
    if (!entries.length) return Promise.resolve({ folderName: null, files: [] });

    return Promise.all(entries.map(function(entry) {
      if (entry.isFile) return readFileEntry(entry);
      if (entry.isDirectory) return readDirectoryEntries(entry);
      return Promise.resolve([]);
    })).then(function(results) {
      var files = [];
      results.forEach(function(r) { files = files.concat(r); });
      return { folderName: folderName, files: files };
    });
  }

  // Process a FileList from <input webkitdirectory>. The folder name is
  // extracted from the first file's webkitRelativePath.
  function readBrowsedFolder(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve({ folderName: null, files: [] });
    var firstPath = files[0].webkitRelativePath || '';
    var folderName = firstPath.split('/')[0] || null;
    return Promise.all(files.map(function(f) {
      return readFileAsText(f).then(function(content) {
        return { name: f.name, content: content };
      });
    })).then(function(fileData) {
      return { folderName: folderName, files: fileData };
    });
  }

  // Create a brand-new gist via the creation form on gist.github.com/.
  // The form includes anti-spam fields (timestamp, honeypot) that we preserve
  // by fetching the real page and serializing its form — but we skip the
  // template file fields and description, replacing them with our own via
  // extraFields. All gists are created as secret (gist[public]=0).
  function createNewGist(description, files, isPublic) {
    return fetch('/', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load gist creation page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        // Find the creation form — look for one that has a gist[description] field.
        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('[name="gist[description]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Gist creation form not found');

        // Collect template fields to skip: description, default file slots,
        // and the public flag — we'll re-add them with our values.
        var skipEls = [];
        var descEl = form.querySelector('input[name="gist[description]"], textarea[name="gist[description]"]');
        if (descEl) skipEls.push(descEl);

        form.querySelectorAll(
          'input[name="gist[contents][][oid]"], ' +
          'input[name="gist[contents][][name]"], ' +
          'textarea[name="gist[contents][][value]"]'
        ).forEach(function(el) { skipEls.push(el); });

        var publicEl = form.querySelector('input[name="gist[public]"], select[name="gist[public]"]');
        if (publicEl) skipEls.push(publicEl);

        // Build our replacement fields.
        var extraFields = [
          { name: 'gist[description]', value: description }
        ];
        files.forEach(function(f) {
          extraFields.push({ name: 'gist[contents][][oid]', value: '' });
          extraFields.push({ name: 'gist[contents][][name]', value: f.name });
          extraFields.push({ name: 'gist[contents][][value]', value: f.content });
        });
        extraFields.push({ name: 'gist[public]', value: isPublic ? '1' : '0' });

        var body = buildFormBody(form, null, null, { skipEls: skipEls, extraFields: extraFields });
        var action = form.getAttribute('action') || '/';

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        // After redirect, res.url is the new gist's page URL, e.g.
        // https://gist.github.com/mnlynam/abc123
        return res.url;
      });
  }

  // Delete a file from a gist via the edit-form replay path. Rather than
  // omitting the file's fields (which would misalign Rails' positional array
  // grouping), GitHub's own UI keeps the name+oid, empties the value, and
  // injects gist[contents][][delete]=true in the same parameter group.
  // We replicate that by inserting a hidden input into the DOMParser document
  // right after the value textarea so buildFormBody serializes it in the
  // correct position.
  function deleteFileFromGist(gistId, filename) {
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        var form = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          if (forms[i].querySelector('input[name="gist[contents][][oid]"]')) {
            form = forms[i];
            break;
          }
        }
        if (!form) throw new Error('Edit form not found on page');

        // Pair name inputs with value textareas by DOM order.
        var nameInputs = form.querySelectorAll('input[name="gist[contents][][name]"]');
        var valueTas = form.querySelectorAll('textarea[name="gist[contents][][value]"]');
        var targetIdx = -1;
        for (var j = 0; j < nameInputs.length; j++) {
          if (nameInputs[j].value === filename) {
            targetIdx = j;
            break;
          }
        }
        if (targetIdx === -1 && nameInputs.length === 1) targetIdx = 0;
        if (targetIdx === -1) throw new Error('Could not locate file ' + filename);

        var targetValueTa = valueTas[targetIdx];
        if (!targetValueTa) throw new Error('Could not locate value textarea for ' + filename);

        // Inject delete=true right after the value textarea so Rails groups it
        // with this file's record (oid + name + value + delete).
        var deleteInput = doc.createElement('input');
        deleteInput.type = 'hidden';
        deleteInput.setAttribute('name', 'gist[contents][][delete]');
        deleteInput.value = 'true';
        targetValueTa.parentNode.insertBefore(deleteInput, targetValueTa.nextSibling);

        // Empty the value (GitHub does the same on delete).
        var body = buildFormBody(form, targetValueTa, '');
        var action = form.getAttribute('action') || ('/' + pathUser + '/' + gistId);

        return fetch(action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // --- Project rename (in-memory state + remote update) ---
  function applyProjectRename(oldName, newName) {
    if (oldName === newName) return;

    var isMerge = Object.prototype.hasOwnProperty.call(groupMeta, newName);

    if (isMerge) {
      groupMeta[newName].files += groupMeta[oldName].files;
      groupGistIds[newName] = groupGistIds[newName].concat(groupGistIds[oldName]);
      // Drop caches on merge — safer to lazy-reload than try to splice together
      // two partially-loaded file lists.
      delete fileCache[newName];
      // If either side is public, the merged project is public.
      if (groupVisibility[oldName] === 'public') groupVisibility[newName] = 'public';
    } else {
      groupMeta[newName] = groupMeta[oldName];
      groupGistIds[newName] = groupGistIds[oldName];
      groupVisibility[newName] = groupVisibility[oldName] || 'secret';
      if (fileCache[oldName]) fileCache[newName] = fileCache[oldName];
    }

    delete groupMeta[oldName];
    delete groupGistIds[oldName];
    delete groupVisibility[oldName];
    delete fileCache[oldName];

    var idx = sortedKeys.indexOf(oldName);
    if (idx !== -1) sortedKeys.splice(idx, 1);
    if (sortedKeys.indexOf(newName) === -1) sortedKeys.push(newName);
    sortedKeys.sort(projectCompare);

    if (activeProject === oldName) activeProject = newName;
  }

  // Turn an existing element into an in-place editable field. Used for both
  // project tiles and filenames in the left nav. Enter commits, Escape cancels,
  // blur commits. Paste is forced to plain text so arbitrary markup can't end
  // up in user data.
  function startInlineEdit(el, oldValue, onCommit) {
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();

    // Select all existing text so the user can just start typing to replace.
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    var resolved = false;

    function cleanup() {
      el.contentEditable = 'false';
      el.classList.remove('editing');
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('paste', onPaste);
    }

    function cancel() {
      if (resolved) return;
      resolved = true;
      el.textContent = oldValue;
      cleanup();
    }

    function commit() {
      if (resolved) return;
      resolved = true;
      var newValue = (el.textContent || '').trim();
      cleanup();
      if (!newValue || newValue === oldValue) {
        el.textContent = oldValue;
        return;
      }
      el.textContent = newValue;
      onCommit(newValue);
    }

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    }

    function onBlur() {
      commit();
    }

    function onPaste(e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand('insertText', false, text);
    }

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    el.addEventListener('paste', onPaste);
  }

  // POST the new description to every gist in a project group, then update
  // in-memory state and re-render. Called after the user commits an inline
  // edit on a tile name.
  function renameProject(oldName, newName, nameEl) {
    if (nameEl) nameEl.classList.add('saving');

    var gistIds = (groupGistIds[oldName] || []).slice();
    if (!gistIds.length) {
      if (nameEl) nameEl.classList.remove('saving');
      return;
    }

    Promise.all(gistIds.map(function(gistId) {
      return saveGistDescription(gistId, newName);
    })).then(function() {
      applyProjectRename(oldName, newName);
      // Only re-render the tile grid if we're still in browse view. If the
      // user navigated into a project while the save was in flight, the
      // in-memory state is updated and the new name will appear next time
      // they return to browse.
      if (activeProject === null) renderBrowse();
    }).catch(function(err) {
      console.warn('[GistOrg] Rename failed:', err);
      window.alert('Rename failed: ' + (err && err.message ? err.message : 'unknown error'));
      if (nameEl) {
        nameEl.textContent = oldName;
        nameEl.classList.remove('saving');
      }
    });
  }

  // POST a filename change for a single file, then update in-memory state:
  // the file object's .name, the rawCache key, and the left-nav icon (which
  // may change if the extension changed). If the renamed file is currently
  // open, also update the content header.
  function renameFile(fileObj, newName, fnNameEl) {
    var oldName = fileObj.name;
    if (fnNameEl) fnNameEl.classList.add('saving');

    saveGistFilename(fileObj.gistId, oldName, newName).then(function() {
      fileObj.name = newName;

      var oldKey = fileObj.gistId + ':' + oldName;
      var newKey = fileObj.gistId + ':' + newName;
      if (Object.prototype.hasOwnProperty.call(rawCache, oldKey)) {
        rawCache[newKey] = rawCache[oldKey];
        delete rawCache[oldKey];
      }

      // Rebuild the left panel so the icon updates to match the new extension
      // and the click handlers re-bind against the new name.
      buildLeftPanel(activeFile);

      // If this file is currently open in the editor, update the header name
      // in place without re-rendering the editor (which would blow away
      // CodeMirror state and any unsaved edits).
      if (activeFile === fileObj) {
        var chName = mainPanel.querySelector('.go-content-header .ch-name');
        if (chName && chName.firstChild && chName.firstChild.nodeType === 3) {
          chName.firstChild.textContent = newName;
        } else if (chName) {
          chName.textContent = newName;
        }
      }
    }).catch(function(err) {
      console.warn('[GistOrg] File rename failed:', err);
      window.alert('Rename failed: ' + (err && err.message ? err.message : 'unknown error'));
      if (fnNameEl) {
        fnNameEl.textContent = oldName;
        fnNameEl.classList.remove('saving');
      }
    });
  }

  // Delete a single file from the currently open project. After the remote
  // delete succeeds, removes it from in-memory caches and switches the editor
  // to the next available file (or back to the empty-project placeholder).
  function deleteFile(fileObj) {
    var project = activeProject;
    if (!project) return;

    var files = fileCache[project] || [];
    if (files.length <= 1) {
      window.alert('Cannot delete the only file in a project. Delete the project instead.');
      return;
    }

    if (!confirm('Delete "' + fileObj.name + '"?')) return;

    deleteFileFromGist(fileObj.gistId, fileObj.name)
      .then(function() {
        // Remove from in-memory caches.
        delete rawCache[fileObj.gistId + ':' + fileObj.name];
        var idx = files.indexOf(fileObj);
        if (idx !== -1) files.splice(idx, 1);
        if (groupMeta[project]) groupMeta[project].files = Math.max(0, groupMeta[project].files - 1);

        // If the deleted file was the active file, switch to the nearest
        // remaining file (prefer the one below, else the one above).
        if (activeFile === fileObj) {
          var nextFile = files[Math.min(idx, files.length - 1)] || files[0] || null;
          if (nextFile) {
            openFile(nextFile);
          } else {
            activeFile = null;
            buildLeftPanel(null);
            mainPanel.innerHTML = '<div class="go-loading">No files found</div>';
          }
        } else {
          buildLeftPanel(activeFile);
        }
        flashStatus('\u2713 Deleted ' + fileObj.name);
      })
      .catch(function(err) {
        console.warn('[GistOrg] Delete failed:', err);
        window.alert('Delete failed: ' + (err && err.message ? err.message : 'unknown error'));
      });
  }

  // --- Add files to project (drag-drop + browse) ---

  // Briefly flash a status banner above the main panel content. Used for
  // upload success/error feedback since uploads happen outside the editor's
  // own save/status flow.
  function flashStatus(msg, kind) {
    var status = document.createElement('div');
    status.className = 'go-status ' + (kind || 'success');
    status.textContent = msg;
    // Insert at the top of mainPanel so it's visible regardless of what's
    // currently rendered (tile grid, editor, or markdown view).
    if (mainPanel.firstChild) {
      mainPanel.insertBefore(status, mainPanel.firstChild);
    } else {
      mainPanel.appendChild(status);
    }
    setTimeout(function() { if (status.parentNode) status.remove(); }, kind === 'error' ? 5000 : 2500);
  }

  // --- File link helpers ---
  // GitHub uses #file-... fragments to link to a specific file inside a gist.
  // The slug is the filename lowercased with dots replaced by hyphens.
  function gistFileAnchor(name) {
    return 'file-' + name.replace(/\./g, '-').toLowerCase();
  }

  // Pull the revision SHA out of a /raw/ URL like
  // https://gist.githubusercontent.com/u/abc/raw/<sha>/file.txt.
  function gistShaFromRawUrl(rawUrl) {
    if (!rawUrl) return null;
    var m = /\/raw\/([a-f0-9]+)\//.exec(rawUrl);
    return m ? m[1] : null;
  }

  // Build the URL for a given file + variant. The four variants match the
  // names GitHub itself uses (Y-shortcut → "permalink"; "Raw" button copies
  // the unpinned raw URL; the REST API `raw_url` field is SHA-pinned and is
  // commonly called the "raw permalink"). Returns null when a permalink
  // variant is requested but no SHA is supplied.
  function buildGistFileUrl(file, variant, sha) {
    var anchor = gistFileAnchor(file.name);
    var pageBase = 'https://gist.github.com/' + pathUser + '/' + file.gistId;
    var rawBase = 'https://gist.githubusercontent.com/' + pathUser + '/' + file.gistId;
    switch (variant) {
      case 'gistPage':       return pageBase + '#' + anchor;
      case 'gistPermalink':  return sha ? pageBase + '/' + sha + '#' + anchor : null;
      case 'raw':            return rawBase + '/raw/' + file.name;
      case 'rawPermalink':   return sha ? rawBase + '/raw/' + sha + '/' + file.name : null;
    }
    return null;
  }

  // Resolve a gist's current revision SHA by scraping any /raw/ link on the
  // gist page. Used when a file was just created in-session and its rawUrl
  // hasn't been refreshed yet.
  function fetchGistSha(gistId) {
    return fetch('/' + pathUser + '/' + gistId, { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load gist (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var m = /\/raw\/([a-f0-9]+)\//.exec(html);
        if (!m) throw new Error('Could not find revision SHA');
        return m[1];
      });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('execCommand copy failed'));
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  // Build the two-row inline-link menu items used by both the header
  // dropdown and the right-click context menu. The 2x2 structure (rows =
  // viewer/raw, inline links = latest/permalink) mirrors the conceptual
  // grid: viewer URLs are for humans, raw URLs are for machines; permalink
  // freezes the SHA. `withCopyVerb` true prefixes each row with "Copy "
  // (right-click menu where rows aren't grouped under a header).
  function buildCopyLinkMenuItems(file, withCopyVerb) {
    function row(label, latestVariant, permalinkVariant) {
      return { render: function(mi) {
        mi.appendChild(document.createTextNode(label + ' '));
        var a = document.createElement('span');
        a.className = 'go-context-link';
        a.textContent = 'link';
        a.addEventListener('click', function(e) {
          e.stopPropagation();
          closeContextMenu();
          copyFileLink(file, latestVariant);
        });
        mi.appendChild(a);
        mi.appendChild(document.createTextNode(' / '));
        var b = document.createElement('span');
        b.className = 'go-context-link';
        b.textContent = 'permalink';
        b.addEventListener('click', function(e) {
          e.stopPropagation();
          closeContextMenu();
          copyFileLink(file, permalinkVariant);
        });
        mi.appendChild(b);
      }};
    }
    if (withCopyVerb) {
      return [
        row('Copy gist', 'gistPage', 'gistPermalink'),
        row('Copy raw', 'raw', 'rawPermalink')
      ];
    }
    return [
      row('Gist', 'gistPage', 'gistPermalink'),
      row('Raw', 'raw', 'rawPermalink')
    ];
  }

  // Header split-button: main click copies the default (Gist page — the
  // most-common share-with-a-human use case), chevron opens the dropdown
  // for the other three variants. Returns the wrapper element.
  function buildCopyLinkSplitButton(file) {
    var wrap = document.createElement('span');
    wrap.className = 'go-btn-split';

    var main = document.createElement('button');
    main.className = 'go-btn go-btn-split-main';
    main.textContent = 'Copy link';
    main.title = 'Copy link to this file (latest viewer URL)';
    main.addEventListener('click', function() {
      copyFileLink(file, 'gistPage');
    });

    var chev = document.createElement('button');
    chev.className = 'go-btn go-btn-split-chev';
    chev.textContent = '▾';
    chev.title = 'More link options';
    chev.addEventListener('click', function() {
      var rect = chev.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom, buildCopyLinkMenuItems(file, false));
    });

    wrap.appendChild(main);
    wrap.appendChild(chev);
    return wrap;
  }

  // Copy a file URL of the given variant ('gistPage' | 'gistPermalink' |
  // 'raw' | 'rawPermalink') and confirm via flashStatus so the user can see
  // exactly what was copied. Falls back to fetching the SHA when a permalink
  // variant is requested but the cached rawUrl doesn't have one (e.g. for
  // newly-created files).
  function copyFileLink(file, variant) {
    function done(url) {
      copyToClipboard(url).then(function() {
        flashStatus('✓ Copied: ' + url);
      }).catch(function(err) {
        flashStatus('✗ Copy failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      });
    }

    var needsSha = (variant === 'gistPermalink' || variant === 'rawPermalink');
    if (!needsSha) { done(buildGistFileUrl(file, variant, null)); return; }

    var cachedSha = gistShaFromRawUrl(file.rawUrl);
    if (cachedSha) { done(buildGistFileUrl(file, variant, cachedSha)); return; }

    fetchGistSha(file.gistId).then(function(sha) {
      done(buildGistFileUrl(file, variant, sha));
    }).catch(function(err) {
      flashStatus('✗ Could not resolve revision: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // --- Archive helpers ---

  // Filename used inside the archive gist:
  //   {YYYY-MM-DD-HH-mm-ss}--{ProjectName}--{originalName}
  // Project names containing the `--` delimiter are collapsed to single `-`
  // so parsing back is unambiguous in the common case.
  function archiveFilenameFor(projectName, originalName, date) {
    var d = date || new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    var ts = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' +
             pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
    var safeProject = projectName.replace(/--/g, '-');
    return ts + '--' + safeProject + '--' + originalName;
  }

  // Parse an archive filename back into its parts. Returns null if the name
  // doesn't match the archive format (treat as a regular file).
  function parseArchiveFilename(name) {
    var m = /^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})--([\s\S]+?)--([\s\S]+)$/.exec(name);
    if (!m) return null;
    return { timestamp: m[1], projectName: m[2], originalName: m[3] };
  }

  // True if the given project name is the archive gist.
  function isArchiveProject(projectName) {
    return projectName === ARCHIVE_DESCRIPTION;
  }

  // Find the archive gist's ID via in-memory state. Returns null if not yet
  // known (extension hasn't seen it this session and it doesn't exist yet).
  function findArchiveGistId() {
    var ids = groupGistIds[ARCHIVE_DESCRIPTION];
    return (ids && ids[0]) || null;
  }

  // Resolve to the archive gist's ID, creating it if it doesn't exist. The
  // newly created gist gets a placeholder README explaining what it is so
  // it isn't a confusing empty gist if the user finds it on github.com.
  function ensureArchiveGist() {
    var existing = findArchiveGistId();
    if (existing) return Promise.resolve(existing);
    var placeholder = {
      name: 'README.md',
      content: '# Gist Organizer Archive\n\nThis gist is managed by the Gist Organizer Chrome extension. Files here are archives moved from your other projects. Filenames follow the format `{timestamp}--{ProjectName}--{originalName}` so the extension can restore them to the right project.\n'
    };
    return createNewGist(ARCHIVE_DESCRIPTION, [placeholder], false).then(function(gistUrl) {
      var parts = (gistUrl || '').split('/').filter(Boolean);
      var gistId = parts[parts.length - 1];
      if (!gistId || gistId.length < 5) throw new Error('Could not determine archive gist ID from ' + gistUrl);
      // Update in-memory state so subsequent operations find this gist.
      groupMeta[ARCHIVE_DESCRIPTION] = { files: 1, time: 'just now' };
      groupGistIds[ARCHIVE_DESCRIPTION] = [gistId];
      groupVisibility[ARCHIVE_DESCRIPTION] = 'secret';
      if (sortedKeys.indexOf(ARCHIVE_DESCRIPTION) === -1) {
        sortedKeys.push(ARCHIVE_DESCRIPTION);
        sortedKeys.sort(projectCompare);
      }
      return gistId;
    });
  }

  // Copy a file into the archive gist with the encoded archive filename, then
  // verify it's there before resolving. Does NOT delete from source — caller
  // does that explicitly so partial failure leaves source intact.
  function copyFileToArchive(file, projectName) {
    return fetchRawContent(file.gistId, file.name).then(function(content) {
      return ensureArchiveGist().then(function(archiveGistId) {
        var archiveName = archiveFilenameFor(projectName, file.name);
        return addFileToGist(archiveGistId, archiveName, content)
          .then(function() { return fetchGistFiles(archiveGistId, { fresh: true }); })
          .then(function(files) {
            var found = files.some(function(f) { return f.name === archiveName; });
            if (!found) throw new Error('Verification failed: "' + archiveName + '" not in archive after upload');
            return archiveName;
          });
      });
    });
  }

  // Archive a single file: copy + verify + delete-from-source.
  function archiveFile(file, projectName) {
    return copyFileToArchive(file, projectName).then(function() {
      return deleteFileFromGist(file.gistId, file.name);
    });
  }

  // Archive every file in every gist of a project, then delete the source
  // gists. Files copy in sequence (each touches the gist's edit form, which
  // serializes anyway) so partial failure stops cleanly.
  function archiveProject(projectName) {
    var gistIds = (groupGistIds[projectName] || []).slice();
    if (!gistIds.length) return Promise.reject(new Error('No gists found for "' + projectName + '"'));

    var cached = fileCache[projectName];
    var ensureFiles = (cached && cached.length)
      ? Promise.resolve(cached.slice())
      : Promise.all(gistIds.map(fetchGistFiles)).then(function(results) {
          var all = [];
          results.forEach(function(fs) { all = all.concat(fs); });
          return all;
        });

    return ensureFiles.then(function(allFiles) {
      return allFiles.reduce(function(p, f) {
        return p.then(function() { return copyFileToArchive(f, projectName); });
      }, Promise.resolve());
    }).then(function() {
      // All files verified in archive — safe to delete the source gists.
      return Promise.all(gistIds.map(deleteGist));
    });
  }

  // Restore one archived file to its original project. If the original
  // project no longer exists, create a new gist for it. Verifies the file
  // landed in the destination before deleting from archive.
  function unarchiveFile(file) {
    var parsed = parseArchiveFilename(file.name);
    if (!parsed) return Promise.reject(new Error('"' + file.name + '" is not an archive filename'));

    return fetchRawContent(file.gistId, file.name).then(function(content) {
      var existingIds = groupGistIds[parsed.projectName];
      if (existingIds && existingIds.length) {
        var destGistId = existingIds[0];
        return addFileToGist(destGistId, parsed.originalName, content)
          .then(function() { return fetchGistFiles(destGistId, { fresh: true }); })
          .then(function(files) {
            var found = files.some(function(f) { return f.name === parsed.originalName; });
            if (!found) throw new Error('Verification failed: file not in destination project');
            return deleteFileFromGist(file.gistId, file.name);
          });
      }
      // Original project gone — create a new gist for it. Use the user's
      // default visibility so the restored project matches their convention.
      var isPublic = settings.defaultVisibility === 'public';
      return createNewGist(parsed.projectName, [{ name: parsed.originalName, content: content }], isPublic)
        .then(function(gistUrl) {
          var parts = (gistUrl || '').split('/').filter(Boolean);
          var newGistId = parts[parts.length - 1];
          if (!newGistId || newGistId.length < 5) throw new Error('Could not determine new gist ID');
          // Mirror createProject's in-memory bookkeeping so the project shows
          // up immediately in the tile grid after the page returns.
          groupMeta[parsed.projectName] = { files: 1, time: 'just now' };
          groupGistIds[parsed.projectName] = [newGistId];
          groupVisibility[parsed.projectName] = isPublic ? 'public' : 'secret';
          if (sortedKeys.indexOf(parsed.projectName) === -1) {
            sortedKeys.push(parsed.projectName);
            sortedKeys.sort(projectCompare);
          }
          return deleteFileFromGist(file.gistId, file.name);
        });
    });
  }

  // UI handlers — confirm with the user, run the operation, refresh state.
  // Optimistic-UI handlers: the in-memory state is mutated first so the file
  // (or project) appears to disappear instantly, then the network operation
  // runs in the background. If the verify-then-delete step fails, the
  // snapshot is restored and an error flash explains. Modeled on the
  // optimistic star/unstar pattern.

  function handleArchiveFile(file, projectName) {
    var files = fileCache[projectName] || [];
    if (files.length <= 1) {
      window.alert('Cannot archive the only file in a project. Use "Archive project" instead.');
      return;
    }
    if (!confirm('Archive "' + file.name + '"? It will be moved to your archive gist.')) return;

    // Snapshot for revert.
    var origIndex = files.indexOf(file);
    var origMeta = groupMeta[projectName] ? Object.assign({}, groupMeta[projectName]) : null;
    var wasActive = (activeFile === file);

    // Optimistic update.
    if (origIndex !== -1) files.splice(origIndex, 1);
    if (origMeta) groupMeta[projectName].files = Math.max(0, origMeta.files - 1);
    if (wasActive) {
      var nextFile = files[Math.min(origIndex, files.length - 1)] || files[0] || null;
      if (nextFile) openFile(nextFile);
      else { activeFile = null; buildLeftPanel(null); mainPanel.innerHTML = '<div class="go-loading">No files found</div>'; }
    } else if (activeProject === projectName) {
      buildLeftPanel(activeFile);
    } else if (rerenderTiles) {
      rerenderTiles();
    }

    archiveFile(file, projectName).then(function() {
      delete rawCache[file.gistId + ':' + file.name];
      delete editPageCache[file.gistId];
      var archiveId = findArchiveGistId();
      if (archiveId) { delete fileCache[ARCHIVE_DESCRIPTION]; delete editPageCache[archiveId]; }
    }).catch(function(err) {
      if (files.indexOf(file) === -1) {
        files.splice(Math.min(origIndex, files.length), 0, file);
      }
      if (origMeta) groupMeta[projectName] = origMeta;
      if (activeProject === projectName) buildLeftPanel(activeFile);
      else if (rerenderTiles) rerenderTiles();
      console.warn('[GistOrg] Archive failed:', err);
      flashStatus('✗ Archive failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  function handleArchiveProject(projectName) {
    var fileCount = (groupMeta[projectName] && groupMeta[projectName].files) || 0;
    if (!confirm('Archive project "' + projectName + '" (' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') + ')? All files will be moved to your archive gist and the source gists will be deleted.')) return;

    // Snapshot.
    var origFileCache = fileCache[projectName];
    var origMeta = groupMeta[projectName];
    var origGistIds = groupGistIds[projectName];
    var origVisibility = groupVisibility[projectName];
    var origIndex = sortedKeys.indexOf(projectName);
    var wasActive = (activeProject === projectName);

    // Optimistic: drop the project from in-memory state and re-render.
    delete fileCache[projectName];
    delete groupMeta[projectName];
    delete groupGistIds[projectName];
    delete groupVisibility[projectName];
    if (origIndex !== -1) sortedKeys.splice(origIndex, 1);
    if (wasActive) renderBrowse();
    else if (rerenderTiles) rerenderTiles();

    archiveProject(projectName).then(function() {
      var archiveId = findArchiveGistId();
      if (archiveId) { delete fileCache[ARCHIVE_DESCRIPTION]; delete editPageCache[archiveId]; }
    }).catch(function(err) {
      if (origFileCache) fileCache[projectName] = origFileCache;
      if (origMeta) groupMeta[projectName] = origMeta;
      if (origGistIds) groupGistIds[projectName] = origGistIds;
      if (origVisibility) groupVisibility[projectName] = origVisibility;
      if (sortedKeys.indexOf(projectName) === -1) {
        sortedKeys.splice(Math.max(0, origIndex), 0, projectName);
      }
      if (rerenderTiles) rerenderTiles();
      console.warn('[GistOrg] Archive project failed:', err);
      flashStatus('✗ Archive project failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  function handleUnarchiveFile(file) {
    var parsed = parseArchiveFilename(file.name);
    if (!parsed) {
      flashStatus('✗ "' + file.name + '" is not a recognized archive filename', 'error');
      return;
    }
    if (!confirm('Unarchive "' + parsed.originalName + '" back to project "' + parsed.projectName + '"?')) return;

    // Snapshot the archive view's state.
    var archiveFiles = fileCache[ARCHIVE_DESCRIPTION] || [];
    var origIndex = archiveFiles.indexOf(file);
    var origMeta = groupMeta[ARCHIVE_DESCRIPTION] ? Object.assign({}, groupMeta[ARCHIVE_DESCRIPTION]) : null;
    var wasActive = (activeFile === file);

    // Optimistic: remove from archive view immediately.
    if (origIndex !== -1) archiveFiles.splice(origIndex, 1);
    if (origMeta) groupMeta[ARCHIVE_DESCRIPTION].files = Math.max(0, origMeta.files - 1);
    if (activeProject === ARCHIVE_DESCRIPTION) {
      if (wasActive) {
        var nextFile = archiveFiles[Math.min(origIndex, archiveFiles.length - 1)] || archiveFiles[0] || null;
        if (nextFile) openFile(nextFile);
        else { activeFile = null; buildLeftPanel(null); mainPanel.innerHTML = '<div class="go-loading">No files found</div>'; }
      } else {
        buildLeftPanel(activeFile);
      }
    }

    unarchiveFile(file).then(function() {
      // Drop caches so the destination project picks up the new file when next opened.
      delete fileCache[parsed.projectName];
      var destIds = groupGistIds[parsed.projectName] || [];
      destIds.forEach(function(id) { delete editPageCache[id]; });
      delete rawCache[file.gistId + ':' + file.name];
      var archiveId = findArchiveGistId();
      if (archiveId) delete editPageCache[archiveId];
    }).catch(function(err) {
      if (archiveFiles.indexOf(file) === -1) {
        archiveFiles.splice(Math.min(origIndex, archiveFiles.length), 0, file);
      }
      if (origMeta) groupMeta[ARCHIVE_DESCRIPTION] = origMeta;
      if (activeProject === ARCHIVE_DESCRIPTION) buildLeftPanel(activeFile);
      console.warn('[GistOrg] Unarchive failed:', err);
      flashStatus('✗ Unarchive failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // Handle a FileList (from drag-drop or file input) being added to the
  // currently open project. Walks the list sequentially — each upload has to
  // wait for the previous one because they all POST to the same gist's edit
  // form (each POST invalidates the old oids). On filename conflict, prompts
  // the user to rename or cancel that one file.
  function handleAddFiles(fileList) {
    var project = activeProject;
    if (!project) return;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    // Pick a target gist: prefer the currently open file's gist (that's what
    // the user's mental "current location" is), fall back to the first gist in
    // the project group. In practice most projects map to one gist; multi-gist
    // projects are only created when the user has multiple gists with the
    // same description.
    var targetGistId = (activeFile && activeFile.gistId) || (groupGistIds[project] || [])[0];
    if (!targetGistId) { window.alert('No gist found for this project'); return; }

    // Local copy of existing filenames that we grow as uploads succeed, so
    // later files in the same batch see earlier uploads as "existing".
    var existingNames = (fileCache[project] || []).map(function(f) { return f.name; });

    function uploadOne(i) {
      if (i >= files.length) return Promise.resolve();
      var file = files[i];
      var filename = file.name;

      // Resolve conflicts by prompting for a new name. Null (Cancel) skips
      // this file but continues the batch; empty name also skips.
      while (existingNames.indexOf(filename) !== -1) {
        var newName = window.prompt(
          'A file named "' + filename + '" already exists in this project.\n' +
          'Enter a new name (or Cancel to skip this file):',
          filename
        );
        if (newName === null) return uploadOne(i + 1);
        filename = (newName || '').trim();
        if (!filename) return uploadOne(i + 1);
      }

      var finalName = filename;
      return readFileAsText(file)
        .then(function(content) {
          return addFileToGist(targetGistId, finalName, content).then(function() { return content; });
        })
        .then(function(content) {
          existingNames.push(finalName);
          // Mutate the in-memory file list so the left panel rebuild shows the
          // new file immediately, without a full project reload.
          if (fileCache[project]) {
            fileCache[project].push({
              name: finalName,
              gistId: targetGistId,
              rawText: content,
              rawUrl: null,
              renderedHtml: ''
            });
          }
          if (groupMeta[project]) groupMeta[project].files += 1;
          rawCache[targetGistId + ':' + finalName] = content;
          // Rebuild the left panel after each successful upload so progress is
          // visible, but only if the user is still viewing the same project.
          if (activeProject === project) buildLeftPanel(activeFile);
          return uploadOne(i + 1);
        })
        .catch(function(err) {
          console.warn('[GistOrg] Upload failed for', finalName, err);
          flashStatus('Upload failed for ' + finalName + ': ' + (err && err.message ? err.message : 'unknown error'), 'error');
          return uploadOne(i + 1);
        });
    }

    uploadOne(0).then(function() {
      if (activeProject === project) {
        buildLeftPanel(activeFile);
        flashStatus('\u2713 Added ' + files.length + ' file' + (files.length !== 1 ? 's' : ''));
      }
    });
  }

  // Create an empty file in the active project via prompt. Opens the new
  // file in the editor on success.
  function handleCreateFile() {
    var project = activeProject;
    if (!project) return;
    var targetGistId = (activeFile && activeFile.gistId) || (groupGistIds[project] || [])[0];
    if (!targetGistId) { window.alert('No gist found for this project'); return; }

    var existingNames = (fileCache[project] || []).map(function(f) { return f.name; });
    var filename = window.prompt('Name for new file (e.g. notes.md):', '');
    if (filename === null) return;
    filename = (filename || '').trim();
    if (!filename) return;
    if (existingNames.indexOf(filename) !== -1) {
      window.alert('A file named "' + filename + '" already exists in this project.');
      return;
    }

    addFileToGist(targetGistId, filename, '').then(function() {
      var newFile = {
        name: filename,
        gistId: targetGistId,
        rawText: '',
        rawUrl: null,
        renderedHtml: ''
      };
      if (fileCache[project]) fileCache[project].push(newFile);
      if (groupMeta[project]) groupMeta[project].files += 1;
      rawCache[targetGistId + ':' + filename] = '';
      if (activeProject === project) {
        openFile(newFile);
        flashStatus('\u2713 Created ' + filename);
      }
    }).catch(function(err) {
      console.warn('[GistOrg] Create file failed', err);
      flashStatus('Create failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // --- Create new project ---

  // High-level handler: given a folder name and an array of {name, content},
  // create a new gist and add it to the in-memory project list.
  function handleCreateProject(folderName, fileDataArray) {
    var projectName = (folderName || '').trim();

    // Resolve conflicts / prompt for name.
    while (!projectName || sortedKeys.indexOf(projectName) !== -1) {
      var msg = !projectName
        ? 'Enter a name for the new project:'
        : 'A project named "' + projectName + '" already exists.\nEnter a different name (or Cancel):';
      projectName = window.prompt(msg, projectName || 'New Project');
      if (projectName === null) return; // cancelled
      projectName = projectName.trim();
    }

    if (!fileDataArray || !fileDataArray.length) {
      window.alert('No files found to upload.');
      return;
    }

    // Use the user's default visibility without asking. They can still flip
    // an individual project afterwards via the tile context menu.
    var isPublic = settings.defaultVisibility === 'public';

    // Show a subtle status while uploading.
    var visLabel = isPublic ? 'public' : 'secret';
    flashStatus('Creating ' + visLabel + ' project "' + projectName + '"\u2026');

    createNewGist(projectName, fileDataArray, isPublic)
      .then(function(gistUrl) {
        // Extract gist ID from the redirect URL.
        var parts = (gistUrl || '').split('/').filter(Boolean);
        var gistId = parts[parts.length - 1];
        if (!gistId || gistId.length < 5) throw new Error('Could not determine new gist ID from ' + gistUrl);

        // Add to in-memory state.
        groupMeta[projectName] = { files: fileDataArray.length, time: 'just now' };
        groupGistIds[projectName] = [gistId];
        groupVisibility[projectName] = isPublic ? 'public' : 'secret';
        fileCache[projectName] = fileDataArray.map(function(f) {
          rawCache[gistId + ':' + f.name] = f.content;
          return {
            name: f.name,
            gistId: gistId,
            rawText: f.content,
            rawUrl: null,
            renderedHtml: ''
          };
        });

        if (sortedKeys.indexOf(projectName) === -1) sortedKeys.push(projectName);
        sortedKeys.sort(projectCompare);

        renderBrowse();
        flashStatus('\u2713 Created ' + visLabel + ' project "' + projectName + '"');
      })
      .catch(function(err) {
        console.warn('[GistOrg] Create project failed:', err);
        window.alert('Create project failed: ' + (err && err.message ? err.message : 'unknown error'));
      });
  }

  // --- Delete project ---

  // Delete a gist entirely. The HAR shows this is a POST with
  // _method=delete and an authenticity_token, sent to the gist URL.
  // The CSRF token comes from the gist's own page.
  function deleteGist(gistId) {
    return fetch('/' + pathUser + '/' + gistId, { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load gist page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // Find the delete form — look for a form with _method=delete.
        var deleteForm = null;
        var forms = doc.querySelectorAll('form');
        for (var i = 0; i < forms.length; i++) {
          var methodInput = forms[i].querySelector('input[name="_method"][value="delete"]');
          if (methodInput) { deleteForm = forms[i]; break; }
        }

        // Fall back to finding CSRF token from any form and building manually.
        var csrf = '';
        if (deleteForm) {
          var csrfEl = deleteForm.querySelector('input[name="authenticity_token"]');
          csrf = csrfEl ? (csrfEl.value || csrfEl.getAttribute('value') || '') : '';
        }
        if (!csrf) {
          var anyToken = doc.querySelector('input[name="authenticity_token"]') ||
                         doc.querySelector('meta[name="csrf-token"]');
          if (anyToken) csrf = anyToken.value || anyToken.getAttribute('content') || '';
        }
        if (!csrf) throw new Error('Could not find CSRF token for delete');

        var body = '_method=delete&authenticity_token=' + encodeURIComponent(csrf);

        return fetch('/' + pathUser + '/' + gistId, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // Make a secret gist public. This is a one-way operation — public gists
  // cannot be made secret again. Uses the make_public endpoint observed in
  // the HAR: POST /{user}/{gistId}/make_public with _method=put + CSRF.
  function makeGistPublic(gistId) {
    // Fetch the edit page to get the CSRF token.
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load edit page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var csrf = '';
        var csrfEl = doc.querySelector('input[name="authenticity_token"]') ||
                     doc.querySelector('meta[name="csrf-token"]');
        if (csrfEl) csrf = csrfEl.value || csrfEl.getAttribute('content') || '';
        if (!csrf) throw new Error('Could not find CSRF token');

        var body = '_method=put&authenticity_token=' + encodeURIComponent(csrf);

        return fetch('/' + pathUser + '/' + gistId + '/make_public', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html, application/xhtml+xml'
          },
          credentials: 'include',
          body: body,
          redirect: 'follow'
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303) {
          throw new Error('HTTP ' + res.status);
        }
        delete editPageCache[gistId];
      });
  }

  // Star or unstar a gist. Rails uses per_form_csrf_tokens on this endpoint,
  // so we must extract the authenticity_token from the specific star/unstar
  // form rather than using a global CSRF meta tag. The form is rendered on
  // the gist page itself and reflects the current starred state.
  function toggleStarGist(gistId, star) {
    var action = star ? '/star' : '/unstar';
    return fetch('/' + pathUser + '/' + gistId, { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) throw new Error('Could not load gist page (HTTP ' + res.status + ')');
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var formSelector = 'form[action$="' + action + '"]';
        var form = doc.querySelector(formSelector);
        if (!form) {
          throw new Error('Gist is already ' + (star ? 'starred' : 'unstarred'));
        }
        var csrfEl = form.querySelector('input[name="authenticity_token"]');
        var csrf = csrfEl ? (csrfEl.value || csrfEl.getAttribute('value') || '') : '';
        if (!csrf) throw new Error('Could not find CSRF token in star form');

        var fd = new FormData();
        fd.append('authenticity_token', csrf);
        fd.append('context', 'gist');

        return fetch('/' + pathUser + '/' + gistId + action, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include',
          body: fd
        });
      })
      .then(function(res) {
        if (!res.ok && res.status !== 302 && res.status !== 303 && res.status !== 204) {
          throw new Error('HTTP ' + res.status);
        }
      });
  }

  // Optimistic toggle: flip local state and rerender immediately so the click
  // feels instant, then fire the network request. If it fails, revert the
  // state, rerender, and surface an inline error.
  function handleToggleStar(projectName) {
    var gistIds = (groupGistIds[projectName] || []).slice();
    if (!gistIds.length) return;

    var willStar = !isProjectStarred(projectName);

    var previous = {};
    gistIds.forEach(function(gistId) {
      previous[gistId] = !!starredGistIds[gistId];
      if (willStar) {
        starredGistIds[gistId] = true;
      } else {
        delete starredGistIds[gistId];
      }
    });
    if (rerenderTiles) rerenderTiles();

    Promise.all(gistIds.map(function(gistId) {
      return toggleStarGist(gistId, willStar);
    })).catch(function(err) {
      gistIds.forEach(function(gistId) {
        if (previous[gistId]) {
          starredGistIds[gistId] = true;
        } else {
          delete starredGistIds[gistId];
        }
      });
      if (rerenderTiles) rerenderTiles();
      console.warn('[GistOrg] Star toggle failed:', err);
      flashStatus('\u2717 ' + (willStar ? 'Star' : 'Unstar') + ' failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  // Make all gists in a project public. Shows a warning about irreversibility.
  function handleMakeProjectPublic(projectName) {
    var gistIds = (groupGistIds[projectName] || []).slice();
    if (!gistIds.length) return;

    var ok = confirm(
      'Make "' + projectName + '" public?\n\n' +
      'Public gists are visible to everyone and appear in search.\n' +
      'This cannot be undone \u2014 public gists cannot be made secret again.'
    );
    if (!ok) return;

    flashStatus('Making "' + projectName + '" public\u2026');

    Promise.all(gistIds.map(function(gistId) {
      return makeGistPublic(gistId);
    })).then(function() {
      groupVisibility[projectName] = 'public';
      renderBrowse();
      flashStatus('\u2713 "' + projectName + '" is now public');
    }).catch(function(err) {
      console.warn('[GistOrg] Make public failed:', err);
      window.alert('Make public failed: ' + (err && err.message ? err.message : 'unknown error'));
    });
  }

  // Delete an entire project — deletes every gist in the group, then removes
  // the project from in-memory state and re-renders.
  function handleDeleteProject(projectName) {
    var gistIds = (groupGistIds[projectName] || []).slice();
    if (!gistIds.length) return;

    var fileCount = groupMeta[projectName] ? groupMeta[projectName].files : 0;
    var msg = 'Delete project "' + projectName + '"';
    if (gistIds.length === 1) {
      msg += ' (' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') + ')?';
    } else {
      msg += ' (' + gistIds.length + ' gists, ' + fileCount + ' files)?\n\nThis cannot be undone.';
    }
    if (!confirm(msg)) return;

    flashStatus('Deleting project "' + projectName + '"\u2026');

    Promise.all(gistIds.map(function(gistId) {
      return deleteGist(gistId);
    })).then(function() {
      // Clean up in-memory state.
      delete groupMeta[projectName];
      delete groupGistIds[projectName];
      delete groupVisibility[projectName];
      delete fileCache[projectName];
      var idx = sortedKeys.indexOf(projectName);
      if (idx !== -1) sortedKeys.splice(idx, 1);
      if (activeProject === projectName) activeProject = null;

      renderBrowse();
      flashStatus('\u2713 Deleted project "' + projectName + '"');
    }).catch(function(err) {
      console.warn('[GistOrg] Delete project failed:', err);
      window.alert('Delete project failed: ' + (err && err.message ? err.message : 'unknown error'));
    });
  }

  // --- Context menu ---
  var activeContextMenu = null;

  function closeContextMenu() {
    if (!activeContextMenu) return;
    activeContextMenu.remove();
    activeContextMenu = null;
    document.removeEventListener('mousedown', onContextMenuOutside, true);
    document.removeEventListener('contextmenu', onContextMenuOutside, true);
    document.removeEventListener('keydown', onContextMenuKey, true);
    window.removeEventListener('blur', closeContextMenu);
    window.removeEventListener('resize', closeContextMenu);
    window.removeEventListener('scroll', closeContextMenu, true);
  }

  function onContextMenuOutside(e) {
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  }

  function onContextMenuKey(e) {
    if (e.key === 'Escape') closeContextMenu();
  }

  function showContextMenu(x, y, items) {
    closeContextMenu();

    var menu = document.createElement('div');
    menu.className = 'go-context-menu';

    items.forEach(function(item, idx) {
      // Add a separator before danger items when they're not the first entry.
      if (item.danger && idx > 0) {
        var sep = document.createElement('div');
        sep.className = 'go-context-menu-separator';
        menu.appendChild(sep);
      }
      var mi = document.createElement('div');
      // Items can either be a simple { label, action } pair or supply a
      // `render(mi)` callback to populate the row themselves (used for
      // multi-action rows with inline-link styling).
      if (item.render) {
        mi.className = 'go-context-menu-item split';
        item.render(mi);
      } else {
        mi.className = 'go-context-menu-item' + (item.danger ? ' danger' : '');
        mi.textContent = item.label;
        mi.addEventListener('click', function(e) {
          e.stopPropagation();
          closeContextMenu();
          item.action();
        });
      }
      menu.appendChild(mi);
    });

    // Position off-screen first so we can measure, then clamp to viewport.
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - rect.width - 8);
    var py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, px) + 'px';
    menu.style.top = Math.max(8, py) + 'px';

    activeContextMenu = menu;

    // Defer attachment so the originating contextmenu event doesn't
    // immediately close the menu via the global handlers below.
    setTimeout(function() {
      if (!activeContextMenu) return;
      document.addEventListener('mousedown', onContextMenuOutside, true);
      document.addEventListener('contextmenu', onContextMenuOutside, true);
      document.addEventListener('keydown', onContextMenuKey, true);
      window.addEventListener('blur', closeContextMenu);
      window.addEventListener('resize', closeContextMenu);
      window.addEventListener('scroll', closeContextMenu, true);
    }, 0);
  }

  // --- Left panel builder ---
  function buildLeftPanel(activeFileObj) {
    leftPanel.innerHTML = '';
    var pt = document.createElement('div');
    pt.className = 'go-project-tile';
    var ptIcon = document.createElement('span');
    ptIcon.className = 'pt-icon';
    ptIcon.setAttribute('aria-label', 'Back');
    ptIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="7.5,2.5 3.5,6 7.5,9.5"/></svg>';
    var ptText = document.createElement('div');
    var ptName = document.createElement('div');
    ptName.className = 'pt-name';
    ptName.textContent = activeProject;
    var ptMeta = document.createElement('div');
    ptMeta.className = 'pt-meta';
    ptMeta.textContent = groupMeta[activeProject].files + ' file' + (groupMeta[activeProject].files !== 1 ? 's' : '');
    ptText.appendChild(ptName);
    ptText.appendChild(ptMeta);
    pt.appendChild(ptIcon);
    pt.appendChild(ptText);
    pt.addEventListener('click', function() { if (confirmDiscard()) renderBrowse(); });
    leftPanel.appendChild(pt);

    // Add-file row: click shows a menu with "New file" (empty in-browser) or
    // "Upload file" (native file picker). Users can also drag-drop files onto
    // the panel. The hidden file input is rebuilt on every left-panel render,
    // but that's fine — it only exists to trigger the native file picker.
    var addRow = document.createElement('div');
    addRow.className = 'go-add-file';
    var addIcon = document.createElement('span');
    addIcon.className = 'fn-icon';
    addIcon.textContent = '+';
    var addLabel = document.createElement('span');
    addLabel.className = 'fn-name';
    addLabel.textContent = 'Add file\u2026';
    addRow.appendChild(addIcon);
    addRow.appendChild(addLabel);
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function() {
      handleAddFiles(fileInput.files);
      fileInput.value = '';
    });
    addRow.appendChild(fileInput);
    addRow.addEventListener('click', function(e) {
      var rect = addRow.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom, [
        { label: 'New file\u2026', action: function() { handleCreateFile(); } },
        { label: 'Upload file\u2026', action: function() { fileInput.click(); } }
      ]);
      e.stopPropagation();
    });
    leftPanel.appendChild(addRow);

    // File-type filter — only show when the project actually has multiple
    // extensions to choose between. Scoped to this project and reset on
    // project open/close (see `projectFileExt`).
    var projectExts = collectProjectExtensions(activeProject);
    if (projectFileExt !== 'all' && projectExts.indexOf(projectFileExt) === -1) {
      projectFileExt = 'all';
    }
    if (projectExts.length >= 2) {
      var extSel = document.createElement('select');
      extSel.className = 'go-filter-select go-file-filter';
      var allOpt = document.createElement('option');
      allOpt.value = 'all'; allOpt.textContent = 'Any file type';
      extSel.appendChild(allOpt);
      projectExts.forEach(function(ext) {
        var o = document.createElement('option');
        o.value = ext; o.textContent = '.' + ext;
        extSel.appendChild(o);
      });
      extSel.value = projectFileExt;
      extSel.addEventListener('change', function() {
        projectFileExt = extSel.value;
        buildLeftPanel(activeFileObj);
      });
      leftPanel.appendChild(extSel);
    }

    var files = fileCache[activeProject] || [];
    if (files.length) {
      var nav = document.createElement('ul');
      nav.className = 'go-file-nav';

      function matchesFilter(f) {
        if (projectFileExt === 'all') return true;
        var dot = f.name.lastIndexOf('.');
        var fext = dot > 0 ? f.name.substring(dot + 1).toLowerCase() : '';
        return fext === projectFileExt;
      }

      // Render a single file row. If `pinned`, it's the active file shown at
      // the top even though it doesn't match the current filter — gets an
      // "(open)" hint so the user sees why it's there.
      function renderFileRow(f, pinned) {
        var li = document.createElement('li');
        var classes = [];
        if (activeFileObj && f === activeFileObj) classes.push('active');
        if (pinned) classes.push('pinned');
        if (classes.length) li.className = classes.join(' ');

        var fnIcon = document.createElement('span');
        fnIcon.className = 'fn-icon';
        fnIcon.textContent = fileIcon(f.name);
        var fnName = document.createElement('span');
        fnName.className = 'fn-name';
        fnName.textContent = f.name;
        li.appendChild(fnIcon);
        li.appendChild(fnName);

        if (pinned) {
          var hint = document.createElement('span');
          hint.className = 'fn-hint';
          hint.textContent = '(open)';
          li.appendChild(hint);
        }

        li.addEventListener('click', function() {
          if (f === activeFile) return;
          if (confirmDiscard()) openFile(f);
        });

        // Click-to-rename, but only when the file is already active (same
        // two-click-to-edit pattern as Finder/Explorer: first click selects,
        // second click renames). Inactive file clicks bubble normally so the
        // li handler above opens the file.
        fnName.addEventListener('click', function(e) {
          if (f !== activeFile) return;
          e.stopPropagation();
          if (fnName.isContentEditable) return;
          startInlineEdit(fnName, f.name, function(newName) {
            renameFile(f, newName, fnName);
          });
        });

        li.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          var inArchive = isArchiveProject(activeProject);
          var items = [];
          if (!inArchive) {
            items.push({ label: 'Rename', action: function() {
              startInlineEdit(fnName, f.name, function(newName) {
                renameFile(f, newName, fnName);
              });
            }});
          }
          // Two split-rows mirroring the header dropdown: gist (HTML viewer)
          // and raw (plaintext), each with inline-clickable link/permalink.
          buildCopyLinkMenuItems(f, true).forEach(function(item) { items.push(item); });
          if (inArchive) {
            items.push({ label: 'Unarchive', action: function() {
              handleUnarchiveFile(f);
            }});
          } else {
            items.push({ label: 'Archive', action: function() {
              handleArchiveFile(f, activeProject);
            }});
          }
          items.push({ label: 'Delete file', danger: true, action: function() {
            deleteFile(f);
          }});
          showContextMenu(e.clientX, e.clientY, items);
        });

        nav.appendChild(li);
      }

      // Pin the active file at the top if the filter would otherwise hide it.
      if (activeFileObj && !matchesFilter(activeFileObj)) {
        renderFileRow(activeFileObj, true);
      }
      files.forEach(function(f) {
        if (!matchesFilter(f)) return;
        renderFileRow(f, false);
      });

      leftPanel.appendChild(nav);
    }

    // Re-attach preload progress bar if active for this project.
    if (preloadState && preloadState.project === activeProject && preloadState.el) {
      leftPanel.appendChild(preloadState.el);
    }
  }

  // --- Unsaved indicator helpers ---
  function setModified(modified) {
    hasUnsavedChanges = modified;
    // Update dot in active file nav item
    var activeLi = leftPanel.querySelector('.go-file-nav li.active');
    if (activeLi) {
      var dot = activeLi.querySelector('.fn-modified');
      if (modified && !dot) {
        dot = document.createElement('span');
        dot.className = 'fn-modified';
        activeLi.appendChild(dot);
      } else if (!modified && dot) {
        dot.remove();
      }
    }
    // Update header indicator
    var headerDot = mainPanel.querySelector('.ch-modified');
    if (headerDot) headerDot.style.display = modified ? 'inline' : 'none';
  }

  // --- Render: Browse (tile grid) ---
  function renderBrowse() {
    outerContainer.classList.remove('has-left');
    leftPanel.innerHTML = '';
    mainPanel.innerHTML = '';
    activeProject = null;
    activeFile = null;
    cmInstance = null;
    hasUnsavedChanges = false;
    preloadState = null;
    projectFileExt = 'all';

    var filterBar = buildFilterBar();
    mainPanel.appendChild(filterBar);

    var grid = document.createElement('div');
    grid.className = 'go-tiles';
    mainPanel.appendChild(grid);

    var footer = document.createElement('div');
    footer.className = 'go-footer';
    mainPanel.appendChild(footer);

    // Drag-drop a folder onto the tile grid to create a new project.
    grid.addEventListener('dragover', function(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      var hasFiles = false;
      if (types) { for (var i = 0; i < types.length; i++) { if (types[i] === 'Files') { hasFiles = true; break; } } }
      if (!hasFiles) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      grid.classList.add('drag-over');
    });
    grid.addEventListener('dragleave', function(e) {
      if (!e.relatedTarget || !grid.contains(e.relatedTarget)) {
        grid.classList.remove('drag-over');
      }
    });
    grid.addEventListener('drop', function(e) {
      e.preventDefault();
      grid.classList.remove('drag-over');
      if (!e.dataTransfer) return;
      if (e.dataTransfer.items && e.dataTransfer.items.length) {
        readDroppedItems(e.dataTransfer.items).then(function(result) {
          if (result.files.length) handleCreateProject(result.folderName, result.files);
        });
      } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
        var fileList = Array.prototype.slice.call(e.dataTransfer.files);
        Promise.all(fileList.map(function(f) {
          return readFileAsText(f).then(function(content) { return { name: f.name, content: content }; });
        })).then(function(fileData) {
          handleCreateProject(null, fileData);
        });
      }
    });

    // Fill the grid. Exposed as a closure so changes to filter state can
    // redraw just the tiles without rebuilding the filter bar (which would
    // blur whatever input the user is typing into).
    function redraw() {
      grid.innerHTML = '';
      var visible = filteredProjects();
      visible.forEach(function(project) { grid.appendChild(buildProjectTile(project)); });

      // Don't show the "+ New Project" tile while filters are active —
      // creating a project with active filters hides it behind the filter.
      var filtering = filterState.search || filterState.starred ||
                      filterState.visibility !== 'all';
      if (!filtering) grid.appendChild(buildAddProjectTile());

      if (!visible.length) {
        var empty = document.createElement('div');
        empty.className = 'go-empty';
        empty.textContent = filtering
          ? 'No projects match the current filters.'
          : 'No projects yet. Drag a folder here or click "+ New Project".';
        grid.appendChild(empty);
      }

      // The archive isn't a user-created project \u2014 it's a system container,
      // like a trash folder. Exclude it from both counts so showing or
      // hiding it doesn't change the project count. When the archive is
      // visible, append a note so the user understands why their tile count
      // (which includes the archive) doesn't match the project count.
      function notArchive(p) { return p !== ARCHIVE_DESCRIPTION; }
      var totalCount = sortedKeys.filter(notArchive).length;
      var visibleCount = visible.filter(notArchive).length;
      var archiveShown = visible.indexOf(ARCHIVE_DESCRIPTION) !== -1;

      footer.textContent = 'Gist Organizer v' + VERSION + ' \u00B7 ' +
        visibleCount + ' of ' + totalCount + ' project' +
        (totalCount !== 1 ? 's' : '') +
        (archiveShown ? ' \u00B7 plus archive' : '');
    }
    rerenderTiles = redraw;
    redraw();
  }

  function buildProjectTile(project) {
    var meta = groupMeta[project];
    var isArchive = isArchiveProject(project);
    var tile = document.createElement('div');
    tile.className = 'go-tile' + (isArchive ? ' go-tile-archive' : '');
    var vis = groupVisibility[project] || 'secret';
    var metaText = meta.files + ' file' + (meta.files !== 1 ? 's' : '');
    if (meta.time) metaText += ' \u00B7 ' + meta.time;
    metaText += ' \u00B7 ' + (vis === 'public' ? 'Public' : 'Secret');

    var iconSpan = document.createElement('span');
    iconSpan.className = 'tile-icon';
    // Archive gist gets the box icon to read instantly as a different kind
    // of container vs. the folder icon used for regular projects.
    iconSpan.textContent = isArchive ? '\uD83D\uDCE6' : '\uD83D\uDCC1';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tile-name';
    nameSpan.textContent = project;
    var metaSpan = document.createElement('span');
    metaSpan.className = 'tile-meta';
    metaSpan.textContent = metaText;
    tile.appendChild(iconSpan);
    tile.appendChild(nameSpan);
    tile.appendChild(metaSpan);

    var star = document.createElement('button');
    var starred = isProjectStarred(project);
    star.className = 'tile-star' + (starred ? ' starred' : '');
    star.title = starred ? 'Unstar project' : 'Star project';
    star.textContent = starred ? '\u2605' : '\u2606';
    star.addEventListener('click', function(e) {
      e.stopPropagation();
      handleToggleStar(project);
    });
    tile.appendChild(star);

    tile.addEventListener('click', function() { openProject(project); });
    tile.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      var starred = isProjectStarred(project);
      var menuItems = [
        { label: starred ? 'Unstar' : 'Star', action: function() {
          handleToggleStar(project);
        }}
      ];
      // The archive gist's name and contents are managed by the extension —
      // renaming it would orphan it (lookup is by description), and archiving
      // an archive doesn't make sense.
      if (!isArchive) {
        menuItems.push({ label: 'Rename', action: function() {
          startInlineEdit(nameSpan, project, function(newName) {
            renameProject(project, newName, nameSpan);
          });
        }});
        if (groupVisibility[project] !== 'public') {
          menuItems.push({ label: 'Make Public', action: function() {
            handleMakeProjectPublic(project);
          }});
        }
        menuItems.push({ label: 'Archive project', action: function() {
          handleArchiveProject(project);
        }});
      }
      menuItems.push({ label: 'Delete project', danger: true, action: function() {
        handleDeleteProject(project);
      }});
      showContextMenu(e.clientX, e.clientY, menuItems);
    });
    return tile;
  }

  function buildAddProjectTile() {
    var addTile = document.createElement('div');
    addTile.className = 'go-tile go-tile-add';
    var addIcon = document.createElement('span');
    addIcon.className = 'tile-icon';
    addIcon.textContent = '+';
    var addName = document.createElement('span');
    addName.className = 'tile-name';
    addName.textContent = 'New Project';
    addTile.appendChild(addIcon);
    addTile.appendChild(addName);

    var folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.webkitdirectory = true;
    folderInput.style.display = 'none';
    folderInput.addEventListener('change', function() {
      readBrowsedFolder(folderInput.files).then(function(result) {
        if (result.files.length) handleCreateProject(result.folderName, result.files);
      });
      folderInput.value = '';
    });
    addTile.appendChild(folderInput);
    addTile.addEventListener('click', function() { folderInput.click(); });
    return addTile;
  }

  function buildFilterBar() {
    var bar = document.createElement('div');
    bar.className = 'go-filter-bar' + (filterState.collapsed ? ' collapsed' : '');

    var toggle = document.createElement('button');
    toggle.className = 'go-filter-toggle';
    toggle.type = 'button';
    toggle.innerHTML = '<span class="go-filter-chev"></span><span>Filters</span>';
    toggle.addEventListener('click', function() {
      filterState.collapsed = !filterState.collapsed;
      persistFilterState();
      bar.classList.toggle('collapsed', filterState.collapsed);
    });
    bar.appendChild(toggle);

    var controls = document.createElement('div');
    controls.className = 'go-filter-controls';

    // Name search
    var searchWrap = document.createElement('div');
    searchWrap.className = 'go-filter-search';
    var search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search projects or filenames\u2026';
    search.value = filterState.search || '';
    search.addEventListener('input', function() {
      filterState.search = search.value;
      persistFilterState();
      if (rerenderTiles) rerenderTiles();
    });
    searchWrap.appendChild(search);
    controls.appendChild(searchWrap);

    // Visibility
    var visSel = document.createElement('select');
    visSel.className = 'go-filter-select';
    [['all', 'All visibility'], ['public', 'Public only'], ['secret', 'Secret only']].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1]; visSel.appendChild(o);
    });
    visSel.value = filterState.visibility || 'all';
    visSel.addEventListener('change', function() {
      filterState.visibility = visSel.value;
      persistFilterState();
      if (rerenderTiles) rerenderTiles();
    });
    controls.appendChild(visSel);

    // Starred toggle
    var starLabel = document.createElement('label');
    starLabel.className = 'go-filter-star';
    var starCb = document.createElement('input');
    starCb.type = 'checkbox';
    starCb.checked = !!filterState.starred;
    starCb.addEventListener('change', function() {
      filterState.starred = starCb.checked;
      persistFilterState();
      if (rerenderTiles) rerenderTiles();
    });
    starLabel.appendChild(starCb);
    var starGlyph = document.createElement('span');
    starGlyph.className = 'go-filter-star-glyph';
    starGlyph.textContent = '\u2605';
    starLabel.appendChild(starGlyph);
    starLabel.appendChild(document.createTextNode(' Starred only'));
    controls.appendChild(starLabel);

    // Show-archived toggle
    var archLabel = document.createElement('label');
    archLabel.className = 'go-filter-star';
    var archCb = document.createElement('input');
    archCb.type = 'checkbox';
    archCb.checked = !!filterState.showArchived;
    archCb.addEventListener('change', function() {
      filterState.showArchived = archCb.checked;
      persistFilterState();
      if (rerenderTiles) rerenderTiles();
    });
    archLabel.appendChild(archCb);
    archLabel.appendChild(document.createTextNode(' Show archived'));
    controls.appendChild(archLabel);

    // Clear-filters button (only visible when any filter is active)
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'go-filter-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', function() {
      filterState.search = ''; filterState.visibility = 'all';
      filterState.starred = false; filterState.showArchived = false;
      persistFilterState();
      renderBrowse();
    });
    controls.appendChild(clearBtn);

    bar.appendChild(controls);
    return bar;
  }

  // --- Render: Project ---
  function openProject(project) {
    activeProject = project;
    activeFile = null;
    cmInstance = null;
    hasUnsavedChanges = false;
    projectFileExt = 'all';
    outerContainer.classList.add('has-left');

    buildLeftPanel(null);
    mainPanel.innerHTML = '<div class="go-loading">Loading ' + project + '\u2026</div>';

    if (fileCache[project]) {
      onFilesReady(fileCache[project]);
      return;
    }

    var gistIds = groupGistIds[project];
    Promise.all(gistIds.map(fetchGistFiles)).then(function(results) {
      var allFiles = [];
      results.forEach(function(files) { allFiles = allFiles.concat(files); });
      fileCache[project] = allFiles;
      if (activeProject === project) onFilesReady(allFiles);
    }).catch(function(err) {
      console.warn('[GistOrg] Failed to load project:', err);
      mainPanel.innerHTML = '<div class="go-loading">Could not load ' + project + '</div>';
    });
  }

  function onFilesReady(files) {
    if (files.length) {
      buildLeftPanel(null);
      openFile(files[0]);
      preloadProjectFiles(activeProject, files);
    } else {
      buildLeftPanel(null);
      mainPanel.innerHTML = '<div class="go-loading">No files found</div>';
    }
  }

  // --- Background preloading ---
  // When a project is opened, preload every file's raw content (and edit-page
  // data per unique gist) in the background so that switching between files
  // is instantaneous. Shows a small progress bar at the bottom of the left
  // panel that naturally survives buildLeftPanel calls via the preloadState
  // module-level ref.

  function preloadProjectFiles(project, files) {
    if (!files || files.length === 0) return;

    var FILE_DELAY = 500; // minimum ms between each file's progress tick

    // Build the progress element.
    var el = document.createElement('div');
    el.className = 'go-preload';
    var track = document.createElement('div');
    track.className = 'go-preload-track';
    var fill = document.createElement('div');
    fill.className = 'go-preload-fill';
    track.appendChild(fill);
    var text = document.createElement('div');
    text.className = 'go-preload-text';
    text.textContent = 'Loading files\u2026 0/' + files.length;
    el.appendChild(track);
    el.appendChild(text);

    preloadState = { project: project, total: files.length, loaded: 0, el: el };
    leftPanel.appendChild(el);

    // Collect unique gist IDs and prime edit-page caches in parallel.
    var gistIdSet = {};
    files.forEach(function(f) { gistIdSet[f.gistId] = true; });
    Object.keys(gistIdSet).forEach(function(gistId) {
      fetchEditPageData(gistId);
    });

    function showTick(count) {
      if (!preloadState || preloadState.project !== project) return;
      preloadState.loaded = count;
      var pct = Math.round((count / files.length) * 100);
      fill.style.width = pct + '%';
      text.textContent = 'Loading files\u2026 ' + count + '/' + files.length;
    }

    function finish() {
      if (!preloadState || preloadState.project !== project) return;
      fill.style.width = '100%';
      fill.classList.add('done');
      text.textContent = '\u2713 All files loaded';
      setTimeout(function() {
        if (preloadState && preloadState.project === project) {
          if (el.parentNode) el.remove();
          preloadState = null;
        }
      }, 1200);
    }

    // Walk through files one at a time. Each step fetches the content (which
    // may resolve instantly from cache) then waits for at least FILE_DELAY ms
    // before showing the tick and moving to the next file. The actual fetch
    // runs in parallel with the delay so slow network requests don't add
    // FILE_DELAY on top — they just take however long they take.
    function loadNext(i) {
      if (i >= files.length) { finish(); return; }

      var stepStart = Date.now();
      var f = files[i];

      fetchRawContent(f.gistId, f.name).then(function() {}, function() {}).then(function() {
        if (!preloadState || preloadState.project !== project) return;
        var elapsed = Date.now() - stepStart;
        var wait = Math.max(0, FILE_DELAY - elapsed);
        setTimeout(function() {
          showTick(i + 1);
          loadNext(i + 1);
        }, wait);
      });
    }

    loadNext(0);
  }

  // --- Render: File editor ---
  function isMarkdown(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }

  function openFile(file) {
    activeFile = file;
    cmInstance = null;
    hasUnsavedChanges = false;
    buildLeftPanel(file);
    if (isMarkdown(file.name) && file.renderedHtml) {
      renderMarkdownView(file);
    } else {
      enterEditMode(file);
    }
  }

  // --- Rendered markdown view ---
  function renderMarkdownView(file) {
    mainPanel.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'go-content-header';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'ch-name';
    nameSpan.textContent = file.name;
    var actions = document.createElement('div');
    actions.className = 'ch-actions';

    var editBtn = document.createElement('button');
    editBtn.className = 'go-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function() { enterEditMode(file); });

    var copyBtn = buildCopyLinkSplitButton(file);

    var openBtn = document.createElement('button');
    openBtn.className = 'go-btn';
    openBtn.textContent = 'Open on GitHub';
    openBtn.addEventListener('click', function() {
      var anchor = gistFileAnchor(file.name);
      window.open('/' + pathUser + '/' + file.gistId + '#' + anchor, '_blank');
    });

    actions.appendChild(editBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(openBtn);
    header.appendChild(nameSpan);
    header.appendChild(actions);
    mainPanel.appendChild(header);

    var rendered = document.createElement('div');
    rendered.className = 'go-rendered';
    rendered.innerHTML = file.renderedHtml;
    mainPanel.appendChild(rendered);
  }

  // --- Editor ---
  function enterEditMode(file) {
    cmInstance = null;
    mainPanel.innerHTML = '';

    // Header
    var header = document.createElement('div');
    header.className = 'go-content-header';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'ch-name';
    nameSpan.innerHTML = file.name + '<span class="ch-modified" style="display:none;"> \u25CF</span>';
    var statusSpan = document.createElement('span');
    statusSpan.className = 'ch-status';
    var actions = document.createElement('div');
    actions.className = 'ch-actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'go-btn go-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;

    var copyBtn = buildCopyLinkSplitButton(file);

    var openBtn = document.createElement('button');
    openBtn.className = 'go-btn';
    openBtn.textContent = 'Open on GitHub';
    openBtn.addEventListener('click', function() {
      var anchor = gistFileAnchor(file.name);
      window.open('/' + pathUser + '/' + file.gistId + '#' + anchor, '_blank');
    });

    // Markdown files get a Cancel button to return to rendered view
    if (isMarkdown(file.name) && file.renderedHtml) {
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'go-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function() {
        if (confirmDiscard()) { hasUnsavedChanges = false; renderMarkdownView(file); }
      });
      actions.appendChild(cancelBtn);
    }

    actions.appendChild(copyBtn);
    actions.appendChild(openBtn);
    actions.appendChild(saveBtn);
    header.appendChild(nameSpan);
    header.appendChild(statusSpan);
    header.appendChild(actions);
    mainPanel.appendChild(header);

    function showSaveStatus(msg, kind) {
      statusSpan.textContent = msg;
      statusSpan.className = 'ch-status ' + (kind || '') + ' visible';
      if (statusSpan._clearTimer) clearTimeout(statusSpan._clearTimer);
      var ttl = kind === 'error' ? 5000 : 2000;
      statusSpan._clearTimer = setTimeout(function() {
        statusSpan.className = 'ch-status';
        statusSpan.textContent = '';
      }, ttl);
    }

    var editorArea = document.createElement('div');
    editorArea.className = 'go-editor-area';
    var cacheKey = file.gistId + ':' + file.name;
    var cachedRaw = Object.prototype.hasOwnProperty.call(rawCache, cacheKey);
    var cachedEdit = Object.prototype.hasOwnProperty.call(editPageCache, file.gistId);
    if (!(cachedRaw && cachedEdit)) {
      editorArea.innerHTML = '<div class="go-loading">Loading ' + file.name + '\u2026</div>';
    }
    mainPanel.appendChild(editorArea);

    // Fetch raw content and edit page data in parallel
    Promise.all([
      fetchRawContent(file.gistId, file.name),
      fetchEditPageData(file.gistId)
    ]).then(function(results) {
      var text = results[0];
      editorArea.innerHTML = '';

      var original = text;

      function onSave(getValue) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving\u2026';
        var content = getValue();

        saveFile(file.gistId, file.name, content).then(function() {
          showSaveStatus('\u2713 Saved', 'success');
          original = content;
          saveBtn.textContent = 'Save';
          setModified(false);
          saveBtn.disabled = true;
        }).catch(function(err) {
          showSaveStatus('Save failed: ' + err.message, 'error');
          saveBtn.textContent = 'Save';
          saveBtn.disabled = false;
        });
      }

      function onContentChange(currentValue) {
        var modified = currentValue !== original;
        saveBtn.disabled = !modified;
        setModified(modified);
      }

      // Try CodeMirror, fall back to textarea
      if (typeof CodeMirror !== 'undefined') {
        var cmWrap = document.createElement('div');
        cmWrap.className = 'go-cm-wrap';
        editorArea.appendChild(cmWrap);

        var cm = CodeMirror(cmWrap, {
          value: text,
          mode: getMode(file.name),
          theme: 'material-darker',
          lineNumbers: true,
          matchBrackets: true,
          autoCloseBrackets: true,
          styleActiveLine: true,
          indentUnit: 2,
          tabSize: 2,
          indentWithTabs: false,
          lineWrapping: false,
          extraKeys: {
            Tab: function(cm) {
              if (cm.somethingSelected()) cm.indentSelection('add');
              else cm.replaceSelection('  ', 'end');
            },
            'Shift-Tab': function(cm) { cm.indentSelection('subtract'); },
            'Ctrl-S': function() { if (!saveBtn.disabled) onSave(function() { return cm.getValue(); }); },
            'Cmd-S': function() { if (!saveBtn.disabled) onSave(function() { return cm.getValue(); }); }
          }
        });
        cmInstance = cm;

        cm.on('change', function() { onContentChange(cm.getValue()); });

        saveBtn.addEventListener('click', function() {
          onSave(function() { return cm.getValue(); });
        });

        setTimeout(function() { cm.refresh(); cm.focus(); }, 50);
      } else {
        // Textarea fallback
        var textarea = document.createElement('textarea');
        textarea.className = 'go-editor';
        textarea.value = text;
        textarea.spellcheck = false;

        textarea.addEventListener('input', function() { onContentChange(textarea.value); });

        textarea.addEventListener('keydown', function(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            textarea.dispatchEvent(new Event('input'));
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (!saveBtn.disabled) onSave(function() { return textarea.value; });
          }
        });

        saveBtn.addEventListener('click', function() {
          onSave(function() { return textarea.value; });
        });

        editorArea.appendChild(textarea);
        textarea.focus();
      }
    }).catch(function(err) {
      console.warn('[GistOrg] Editor load failed:', err);
      editorArea.innerHTML = '<div class="go-loading">Could not load ' + file.name + '</div>';
    });
  }

  // --- Start ---
  renderBrowse();
  revealPage();
  fetchStarredGists(); // populates starredGistIds, then rerenders tiles
  console.log('[GistOrg] v' + VERSION + ' loaded, ' + sortedKeys.length + ' project' + (sortedKeys.length !== 1 ? 's' : ''));

  } // end main()
})();
