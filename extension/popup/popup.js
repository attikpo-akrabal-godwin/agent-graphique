/** Popup de configuration — lit/écrit chrome.storage.sync. */
'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  enabled: true,
  wander: true,
  proactive: true,
  vision: true,
  lang: 'fr-FR',
  rate: 1.0,
  pitch: 1.05,
  voiceURI: '',
  model: 'claude-haiku-4-5',
  systemPrompt: ''
};

const PERM_IDS = ['click', 'fill', 'submit', 'open', 'scroll', 'read'];
let currentOrigin = null;

function loadSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      currentOrigin = new URL(tabs[0].url).origin;
      $('siteName').textContent = currentOrigin.replace(/^https?:\/\//, '');
    } catch (_) {
      currentOrigin = null;
      $('siteName').textContent = 'ce site';
    }
    if (!currentOrigin) return;
    const key = 'perm:' + currentOrigin;
    chrome.storage.local.get({ [key]: {} }, (v) => {
      const perms = v[key] || {};
      for (const p of PERM_IDS) $('perm-' + p).checked = !!perms[p];
    });
  });
}

function savePerms() {
  if (!currentOrigin) return;
  const perms = {};
  for (const p of PERM_IDS) perms[p] = $('perm-' + p).checked;
  chrome.storage.local.set({ ['perm:' + currentOrigin]: perms });
}

function populateVoices(selected) {
  const sel = $('voice');
  const voices = speechSynthesis.getVoices();
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Automatique (selon la langue)';
  sel.appendChild(auto);
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    if (v.voiceURI === selected) o.selected = true;
    sel.appendChild(o);
  }
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    $('enabled').checked = s.enabled;
    $('wander').checked = s.wander;
    $('proactive').checked = s.proactive !== false;
    $('vision').checked = s.vision !== false;
    $('rate').value = s.rate;
    $('pitch').value = s.pitch;
    $('rateVal').textContent = Number(s.rate).toFixed(1);
    $('pitchVal').textContent = Number(s.pitch).toFixed(2);
    $('systemPrompt').value = s.systemPrompt || '';
    $('model').value = s.model || 'claude-haiku-4-5';
    populateVoices(s.voiceURI);
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => populateVoices(s.voiceURI);
    }
  });
}

function gather() {
  const voiceURI = $('voice').value;
  // Déduit la langue de la voix choisie pour la reconnaissance vocale
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI);
  return {
    enabled: $('enabled').checked,
    wander: $('wander').checked,
    proactive: $('proactive').checked,
    vision: $('vision').checked,
    rate: parseFloat($('rate').value),
    pitch: parseFloat($('pitch').value),
    voiceURI,
    lang: v ? v.lang.replace('_', '-') : 'fr-FR',
    model: $('model').value,
    systemPrompt: $('systemPrompt').value.trim()
  };
}

function save(showMsg) {
  // La clé API reste en storage.local (jamais synchronisée entre appareils)
  chrome.storage.local.set({ apiKey: $('apiKey').value.trim() });
  savePerms();
  chrome.storage.sync.set(gather(), () => {
    if (showMsg) {
      $('savedMsg').textContent = '✓ Enregistré';
      setTimeout(() => { $('savedMsg').textContent = ''; }, 1800);
    }
  });
}

$('rate').addEventListener('input', () => { $('rateVal').textContent = parseFloat($('rate').value).toFixed(1); });
$('pitch').addEventListener('input', () => { $('pitchVal').textContent = parseFloat($('pitch').value).toFixed(2); });

// Les interrupteurs sauvegardent immédiatement
$('enabled').addEventListener('change', () => save(false));
$('wander').addEventListener('change', () => save(false));
$('proactive').addEventListener('change', () => save(false));
$('vision').addEventListener('change', () => save(false));

$('save').addEventListener('click', () => save(true));

$('testVoice').addEventListener('click', () => {
  save(false);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: 'SPEAK', text: 'Coucou ! Voilà comment je parle maintenant.', emotion: 'happy' },
      () => { void chrome.runtime.lastError; /* onglet sans content script : ignorer */ }
    );
  });
});

// Les permissions sauvegardent immédiatement
for (const p of PERM_IDS) {
  $('perm-' + p).addEventListener('change', savePerms);
}

chrome.storage.local.get({ apiKey: '' }, (v) => { $('apiKey').value = v.apiKey || ''; });

load();
loadSite();
