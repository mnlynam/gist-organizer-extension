// Gist Organizer v2.4.0 — Chrome Extension
// Replaces the flat GitHub Gist list with a project-based file explorer.
// https://github.com/mnlynam/gist-organizer-extension

(function () {
  var VERSION = '2.4.0';

  // hide.css (loaded via manifest at document_start) hides .application-main.
  // revealPage() makes it visible once tiles are built.
  function revealPage() {
    var appMain = document.querySelector('.application-main');
    if (appMain) appMain.style.setProperty('visibility', 'visible', 'important');
  }

  function init() {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

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

  function getLastActive(el) {
    var time = el.querySelector('.gist-snippet-meta relative-time');
    return time ? time.textContent.trim() : '';
  }

  var FILE_ICONS = { js: '\uD83D\uDCDC', html: '\uD83C\uDF10', css: '\uD83C\uDFA8', md: '\uD83D\uDCDD', json: '\u2699\uFE0F', txt: '\uD83D\uDCC4', py: '\uD83D\uDC0D', rb: '\uD83D\uDC8E', sh: '\uD83D\uDCDF', bat: '\uD83D\uDCDF' };
  function fileIcon(name) { var ext = (name.split('.').pop() || '').toLowerCase(); return FILE_ICONS[ext] || '\uD83D\uDCC4'; }

  // --- Group gists by project ---
  var groups = {}, groupMeta = {}, groupGistIds = {};
  snippets.forEach(function(el) {
    var project = getProjectName(el);
    var gistId = getGistId(el);
    if (!groups[project]) { groups[project] = []; groupMeta[project] = { files: 0, time: '' }; groupGistIds[project] = []; }
    groups[project].push(el);
    groupMeta[project].files += getFileCount(el);
    if (!groupMeta[project].time) groupMeta[project].time = getLastActive(el);
    if (gistId) groupGistIds[project].push(gistId);
  });
  var sortedKeys = Object.keys(groups).sort(function(a, b) { return a.localeCompare(b); });

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
    '.go-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; padding: 20px; }',
    '.go-tile { position: relative; aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: var(--bgColor-default, #0d1117); border: 1px solid var(--borderColor-default, #30363d); border-radius: 10px; cursor: pointer; user-select: none; transition: all 0.15s; padding: 16px 12px; text-align: center; }',
    '.go-tile:hover { border-color: var(--borderColor-accent-emphasis, #1f6feb); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }',
    '.go-tile .tile-icon { font-size: 32px; line-height: 1; }',
    '.go-tile .tile-name { font-weight: 600; font-size: 12px; color: var(--fgColor-default, #e6edf3); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding: 1px 4px; border-radius: 3px; }',
    '.go-tile .tile-name.editing { display: block; -webkit-line-clamp: unset; overflow: visible; white-space: normal; word-break: break-word; background: var(--bgColor-default, #0d1117); outline: 2px solid var(--borderColor-accent-emphasis, #1f6feb); cursor: text; user-select: text; }',
    '.go-tile .tile-name.saving { opacity: 0.5; }',
    '.go-tile .tile-meta { font-size: 10px; color: var(--fgColor-muted, #7d8590); }',

    // Footer
    '.go-footer { padding: 12px 20px; text-align: center; font-size: 11px; color: var(--fgColor-muted, #7d8590); border-top: 1px solid var(--borderColor-default, #30363d); }',

    // Left panel
    '.go-project-tile { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--borderColor-default, #30363d); cursor: pointer; }',
    '.go-project-tile:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-project-tile .pt-icon { font-size: 22px; }',
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
    '.go-file-nav li .fn-modified { width: 6px; height: 6px; border-radius: 50%; background: #d29922; margin-left: auto; flex-shrink: 0; }',

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

    // Content header
    '.go-content-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--bgColor-muted, #161b22); border-bottom: 1px solid var(--borderColor-default, #30363d); flex-shrink: 0; }',
    '.go-content-header .ch-name { font-weight: 600; font-size: 14px; color: var(--fgColor-default, #e6edf3); }',
    '.go-content-header .ch-modified { color: #d29922; margin-left: 6px; }',
    '.go-content-header .ch-actions { display: flex; gap: 8px; }',
    '.go-btn { padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--borderColor-default, #30363d); background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); transition: all 0.15s; }',
    '.go-btn:hover { background: var(--bgColor-neutral-muted, #1c2128); }',
    '.go-btn-primary { background: #238636; border-color: #238636; color: #fff; }',
    '.go-btn-primary:hover { background: #2ea043; }',
    '.go-btn-primary:disabled { opacity: 0.5; cursor: default; }',

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
    '.go-editor { width: 100%; flex: 1; padding: 12px 16px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.5; background: var(--bgColor-default, #0d1117); color: var(--fgColor-default, #e6edf3); border: none; resize: none; outline: none; tab-size: 2; }'
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

  // --- Unsaved changes guard ---
  function confirmDiscard() {
    if (!hasUnsavedChanges) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  // Warn on page unload
  window.addEventListener('beforeunload', function(e) {
    if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeProject) {
      if (confirmDiscard()) renderBrowse();
    }
  });

  // --- Fetch helpers ---
  function fetchGistFiles(gistId) {
    return fetch('/' + pathUser + '/' + gistId, { credentials: 'include' })
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

    // Fallback: fetch the edit page (same-origin, has raw content for ALL file types)
    return fetchEditPageData(gistId).then(function(editData) {
      if (editData.fileContents && editData.fileContents[filename]) {
        rawCache[key] = editData.fileContents[filename];
        return editData.fileContents[filename];
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
        doc.querySelectorAll('input[name="gist[contents][][oid]"]').forEach(function(oidEl) {
          var sibling = oidEl;
          var fileName = null;
          while (sibling) {
            if (sibling.getAttribute && sibling.getAttribute('name') === 'gist[contents][][name]') {
              fileName = sibling.value;
              fileOids[fileName] = oidEl.value;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          // Find the file content from CodeMirror textarea or value field
          if (fileName) {
            var fileEditor = oidEl.closest('.file') || oidEl.closest('.js-gist-file-content') || oidEl.parentElement;
            if (fileEditor) {
              var contentArea = fileEditor.querySelector('textarea.file-editor-textarea, textarea[name="gist[contents][][value]"], .CodeMirror');
              if (contentArea && contentArea.value !== undefined) {
                fileContents[fileName] = contentArea.value;
              }
            }
          }
        });
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
  function buildFormBody(form, overrideEl, overrideValue, opts) {
    opts = opts || {};
    var skipEls = opts.skipEls || null;
    var extraFields = opts.extraFields || null;
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
      var value = (el === overrideEl) ? overrideValue : readElementValue(el);
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
    // Always fetch the edit page fresh on save. The page gives us a live <form>
    // with the current CSRF token and oids; reusing cached data risks sending
    // stale oids (the gist may have been edited in another tab) which GitHub
    // rejects with 422.
    return fetch('/' + pathUser + '/' + gistId + '/edit', { credentials: 'include' })
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

        // Pair name inputs with value textareas by DOM order. Rails' bare "[]"
        // array syntax means the Nth name input corresponds to the Nth textarea,
        // which is what querySelectorAll gives us.
        var nameInputs = form.querySelectorAll('input[name="gist[contents][][name]"]');
        var valueTas = form.querySelectorAll('textarea[name="gist[contents][][value]"]');
        var target = null;
        for (var j = 0; j < nameInputs.length; j++) {
          if (nameInputs[j].value === filename) {
            target = valueTas[j] || null;
            break;
          }
        }
        // Single-file gists may have only one textarea even if the name lookup
        // fails for some reason; fall back to that.
        if (!target && valueTas.length === 1) target = valueTas[0];
        if (!target) throw new Error('Could not locate editor for ' + filename);

        // Substitute the new content at serialization time rather than mutating
        // the parsed DOM — see readElementValue() and buildFormBody() for why.
        var body = buildFormBody(form, target, content);
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
    } else {
      groupMeta[newName] = groupMeta[oldName];
      groupGistIds[newName] = groupGistIds[oldName];
      if (fileCache[oldName]) fileCache[newName] = fileCache[oldName];
    }

    delete groupMeta[oldName];
    delete groupGistIds[oldName];
    delete fileCache[oldName];

    var idx = sortedKeys.indexOf(oldName);
    if (idx !== -1) sortedKeys.splice(idx, 1);
    if (sortedKeys.indexOf(newName) === -1) sortedKeys.push(newName);
    sortedKeys.sort(function(a, b) { return a.localeCompare(b); });

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

    items.forEach(function(item) {
      var mi = document.createElement('div');
      mi.className = 'go-context-menu-item';
      mi.textContent = item.label;
      mi.addEventListener('click', function(e) {
        e.stopPropagation();
        closeContextMenu();
        item.action();
      });
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
    ptIcon.textContent = '\u2190';
    var ptText = document.createElement('div');
    var ptName = document.createElement('div');
    ptName.className = 'pt-name';
    ptName.textContent = activeProject;
    var ptMeta = document.createElement('div');
    ptMeta.className = 'pt-meta';
    ptMeta.textContent = groupMeta[activeProject].files + ' files';
    ptText.appendChild(ptName);
    ptText.appendChild(ptMeta);
    pt.appendChild(ptIcon);
    pt.appendChild(ptText);
    pt.addEventListener('click', function() { if (confirmDiscard()) renderBrowse(); });
    leftPanel.appendChild(pt);

    // Add-file row: click to browse, or users can drag-drop files onto the
    // panel. The hidden file input is rebuilt on every left-panel render, but
    // that's fine — it only exists to trigger the native file picker.
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
    addRow.addEventListener('click', function() { fileInput.click(); });
    leftPanel.appendChild(addRow);

    var files = fileCache[activeProject] || [];
    if (files.length) {
      var nav = document.createElement('ul');
      nav.className = 'go-file-nav';
      files.forEach(function(f) {
        var li = document.createElement('li');
        if (activeFileObj && f === activeFileObj) li.className = 'active';

        var fnIcon = document.createElement('span');
        fnIcon.className = 'fn-icon';
        fnIcon.textContent = fileIcon(f.name);
        var fnName = document.createElement('span');
        fnName.className = 'fn-name';
        fnName.textContent = f.name;
        li.appendChild(fnIcon);
        li.appendChild(fnName);

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
          showContextMenu(e.clientX, e.clientY, [
            { label: 'Rename', action: function() {
              startInlineEdit(fnName, f.name, function(newName) {
                renameFile(f, newName, fnName);
              });
            }}
          ]);
        });

        nav.appendChild(li);
      });
      leftPanel.appendChild(nav);
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

    var grid = document.createElement('div');
    grid.className = 'go-tiles';

    sortedKeys.forEach(function(project) {
      var meta = groupMeta[project];
      var tile = document.createElement('div');
      tile.className = 'go-tile';
      var metaText = meta.files + ' file' + (meta.files !== 1 ? 's' : '');
      if (meta.time) metaText += ' \u00B7 ' + meta.time;

      // Build via createElement/textContent rather than innerHTML so that
      // user-controlled project names (editable in place) can't smuggle HTML
      // into the tile grid.
      var iconSpan = document.createElement('span');
      iconSpan.className = 'tile-icon';
      iconSpan.textContent = '\uD83D\uDCC1';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'tile-name';
      nameSpan.textContent = project;
      var metaSpan = document.createElement('span');
      metaSpan.className = 'tile-meta';
      metaSpan.textContent = metaText;
      tile.appendChild(iconSpan);
      tile.appendChild(nameSpan);
      tile.appendChild(metaSpan);

      tile.addEventListener('click', function() { openProject(project); });
      tile.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename', action: function() {
            startInlineEdit(nameSpan, project, function(newName) {
              renameProject(project, newName, nameSpan);
            });
          }}
        ]);
      });

      grid.appendChild(tile);
    });

    mainPanel.appendChild(grid);

    // Footer
    var footer = document.createElement('div');
    footer.className = 'go-footer';
    footer.textContent = 'Gist Organizer v' + VERSION + ' \u00B7 ' + sortedKeys.length + ' projects';
    mainPanel.appendChild(footer);
  }

  // --- Render: Project ---
  function openProject(project) {
    activeProject = project;
    activeFile = null;
    cmInstance = null;
    hasUnsavedChanges = false;
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
    } else {
      buildLeftPanel(null);
      mainPanel.innerHTML = '<div class="go-loading">No files found</div>';
    }
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

    var openBtn = document.createElement('button');
    openBtn.className = 'go-btn';
    openBtn.textContent = 'Open on GitHub';
    openBtn.addEventListener('click', function() {
      var anchor = 'file-' + file.name.replace(/\./g, '-').toLowerCase();
      window.open('/' + pathUser + '/' + file.gistId + '#' + anchor, '_blank');
    });

    actions.appendChild(editBtn);
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
    var actions = document.createElement('div');
    actions.className = 'ch-actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'go-btn go-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = true;

    var openBtn = document.createElement('button');
    openBtn.className = 'go-btn';
    openBtn.textContent = 'Open on GitHub';
    openBtn.addEventListener('click', function() {
      var anchor = 'file-' + file.name.replace(/\./g, '-').toLowerCase();
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

    actions.appendChild(openBtn);
    actions.appendChild(saveBtn);
    header.appendChild(nameSpan);
    header.appendChild(actions);
    mainPanel.appendChild(header);

    var editorArea = document.createElement('div');
    editorArea.className = 'go-editor-area';
    editorArea.innerHTML = '<div class="go-loading">Loading ' + file.name + '\u2026</div>';
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
          var status = document.createElement('div');
          status.className = 'go-status success';
          status.textContent = '\u2713 Saved';
          mainPanel.insertBefore(status, editorArea);
          setTimeout(function() { if (status.parentNode) status.remove(); }, 2000);
          original = content;
          saveBtn.textContent = 'Save';
          setModified(false);
          saveBtn.disabled = true;
        }).catch(function(err) {
          var status = document.createElement('div');
          status.className = 'go-status error';
          status.textContent = 'Save failed: ' + err.message;
          mainPanel.insertBefore(status, editorArea);
          setTimeout(function() { if (status.parentNode) status.remove(); }, 5000);
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
  console.log('[GistOrg] v' + VERSION + ' loaded, ' + sortedKeys.length + ' projects');

  } // end main()
})();
