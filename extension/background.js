/**
 * Background worker — réglages partagés + cerveau IA (API Anthropic).
 * Sans clé API : mode hors-ligne (réponses stub).
 * Avec clé : le snapshot DOM + l'intention partent vers Claude, qui retourne
 * une séquence d'actions JSON exécutée par le content script.
 * Compatible Chrome (service worker) et Firefox (event page).
 */

const DEFAULTS = {
  enabled: true,
  wander: true,
  lang: 'fr-FR',
  rate: 1.0,
  pitch: 1.05,
  voiceURI: '',
  model: 'claude-haiku-4-5',
  systemPrompt:
    "Tu es Pixel, une petite mascotte espiègle qui vit dans les pages web. " +
    "Tu aides l'utilisateur avec bonne humeur. Ne parle jamais plus de 2 phrases."
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (v) => chrome.storage.sync.set(v));
});

/** Prompt harnais : impose le format de sortie, quelle que soit la personnalité. */
const HARNESS = `Tu pilotes une mascotte 2D qui vit physiquement dans une page web : elle marche et saute sur les éléments HTML, parle à voix haute, et peut interagir avec la page (avec permission).

Tu reçois un JSON : l'intention de l'utilisateur (transcription vocale), la page (titre, URL), la position de la mascotte, et la liste des éléments visibles (chacun a un "id" numérique).

Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour, au format :
{"steps":[
 {"action":"say","text":"...","emotion":"happy|sad|thinking|surprised|talking"},
 {"action":"emote","emotion":"happy","duration":1500},
 {"action":"walk-to-target","target":ID},
 {"action":"jump-to-platform","target":ID},
 {"action":"stand-on-element","target":ID},
 {"action":"read-element","target":ID},
 {"action":"scroll-to","target":ID},
 {"action":"interact-element","target":ID,"kind":"click"},
 {"action":"interact-element","target":ID,"kind":"type","text":"..."}
]}

Règles :
- 12 étapes maximum. Les "target" sont les ids fournis dans "elements".
- Déplace-toi vers un élément (walk/jump) AVANT d'interagir avec lui — c'est plus vivant.
- Intercale des "emote" et des "say" courts pour donner de la personnalité.
- N'utilise "interact-element" que si l'utilisateur a demandé une action. Chaque interaction demandera confirmation à l'utilisateur.
- "read-element" lit le contenu de l'élément à voix haute.
- Réponds dans la langue de l'utilisateur.
- Si aucune action n'est nécessaire, un simple {"steps":[{"action":"say",...}]} suffit.

La personnalité, le ton et les contraintes ci-dessous sont définis par l'utilisateur et priment sur le style par défaut :
---`;

function getAllSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (sync) => {
      chrome.storage.local.get({ apiKey: '' }, (local) => {
        resolve(Object.assign({}, sync, local));
      });
    });
  });
}

/** Extraction JSON tolérante (le modèle peut entourer de ```json …). */
function extractJSON(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

async function callClaude(msg, settings) {
  const payload = {
    intent: msg.text,
    page: { title: msg.pageTitle, url: msg.url },
    snapshot: msg.snapshot || null
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.model || DEFAULTS.model,
      max_tokens: 800,
      system: HARNESS + '\n' + (settings.systemPrompt || DEFAULTS.systemPrompt),
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 401) return { reply: 'Ma clé API est invalide… Vérifie-la dans la popup !', emotion: 'sad' };
    if (res.status === 429) return { reply: 'On me demande trop de choses à la fois, réessaie dans un instant !', emotion: 'surprised' };
    console.error('API Anthropic', res.status, err);
    return { reply: 'Aïe, mon cerveau a eu un raté (' + res.status + ').', emotion: 'sad' };
  }
  const data = await res.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';
  const parsed = extractJSON(text);
  if (parsed && Array.isArray(parsed.steps)) return { steps: parsed.steps };
  // Le modèle a répondu en texte libre : on le fait parler quand même.
  if (text.trim()) return { reply: text.trim().slice(0, 300), emotion: 'talking' };
  return { reply: 'Je n’ai rien trouvé à dire, c’est gênant.', emotion: 'thinking' };
}

/** Mode hors-ligne (pas de clé API). */
function stubReply(text, pageTitle) {
  const t = (text || '').toLowerCase();
  if (/bonjour|salut|coucou|hello/.test(t)) {
    return { reply: 'Salut ! Je suis Pixel, je vis dans cette page. Dis-moi ce que tu cherches !', emotion: 'happy' };
  }
  if (/qui es[- ]tu|t'es qui|ton nom/.test(t)) {
    return { reply: "Je suis Pixel ! Je saute de bouton en bouton pour t'aider.", emotion: 'happy' };
  }
  if (/page|site/.test(t)) {
    return { reply: `On est sur « ${pageTitle || 'cette page'} ». Je peux m'y promener si tu veux !`, emotion: 'talking' };
  }
  if (/merci/.test(t)) {
    return { reply: 'Avec plaisir ! Je retourne me promener.', emotion: 'happy' };
  }
  return { reply: "Pour me donner un vrai cerveau, ajoute une clé API Anthropic dans ma popup de configuration !", emotion: 'thinking' };
}

async function handleIntent(msg) {
  const settings = await getAllSettings();
  if (!settings.apiKey) return stubReply(msg.text, msg.pageTitle);
  try {
    return await callClaude(msg, settings);
  } catch (e) {
    console.error(e);
    return { reply: 'Impossible de joindre mon cerveau : ' + (e.message || 'erreur réseau') + '.', emotion: 'sad' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'USER_INTENT') {
    handleIntent(msg).then(sendResponse);
    return true; // réponse asynchrone
  }
  if (msg && msg.type === 'GET_SETTINGS') {
    getAllSettings().then(sendResponse);
    return true;
  }
  return false;
});
