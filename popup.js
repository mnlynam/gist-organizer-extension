document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

var DEFAULTS = { enabled: true, defaultVisibility: 'secret', defaultSort: 'name' };
var enabledEl = document.getElementById('enabled');
var visEl = document.getElementById('defaultVisibility');
var sortEl = document.getElementById('defaultSort');

chrome.storage.local.get(DEFAULTS, function(s) {
  enabledEl.checked = !!s.enabled;
  visEl.value = s.defaultVisibility;
  sortEl.value = s.defaultSort;
});

function save(key, val) {
  var patch = {};
  patch[key] = val;
  chrome.storage.local.set(patch);
}

enabledEl.addEventListener('change', function() { save('enabled', enabledEl.checked); });
visEl.addEventListener('change', function() { save('defaultVisibility', visEl.value); });
sortEl.addEventListener('change', function() { save('defaultSort', sortEl.value); });
