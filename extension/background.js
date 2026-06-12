/**
 * Background worker — réglages partagés + cerveau IA (API Anthropic).
 * v3 : la mascotte VOIT la page (capture d'écran envoyée au modèle), dispose
 * d'un vocabulaire d'actions élargi (vraie automatisation), et garde une
 * mémoire de session injectée dans chaque appel pour la continuité entre onglets.
 * Sans clé API : mode hors-ligne (réponses stub).
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
  vision: true,        // envoyer une capture d'écran au modèle
  proactive: true,     // réagir seul aux erreurs/modales
  systemPrompt:
    "Tu es Pixel, une petite mascotte espiègle qui vit dans les pages web. " +
    "Tu aides l'utilisateur avec bonne humeur. Ne parle jamais plus de 2 phrases."
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (v) => chrome.storage.sync.set(v));
});

/** Prompt harnais : impose le format de sortie, quelle que soit la personnalité. */
const HARNESS = `Tu pilotes une mascotte 2D qui vit physiquement dans une page web : elle marche et saute sur les éléments HTML, parle à voix haute, et peut automatiser la page (avec permission).

Tu reçois un JSON : l'intention de l'utilisateur, la page (titre, URL), la position de la mascotte, la liste des éléments visibles (chacun a un "id" numérique), et "memory" (résumé des échanges précédents — sers-t'en pour la continuité). Une capture d'écran de la page peut accompagner le message : appuie-toi dessus pour comprendre la mise en page et localiser les bons éléments.

Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour, au format :
{"steps":[
 {"action":"say","text":"...","emotion":"happy|sad|thinking|surprised|talking"},
 {"action":"emote","emotion":"happy","duration":1500},
 {"action":"walk-to-target","target":ID},
 {"action":"jump-to-platform","target":ID},
 {"action":"read-element","target":ID},
 {"action":"scroll-to","target":ID},
 {"action":"scroll-by","dy":600},
 {"action":"hover","target":ID},
 {"action":"navigate","url":"https://..."},
 {"action":"go-back"},
 {"action":"go-forward"},
 {"action":"interact-element","target":ID,"kind":"click"},
 {"action":"interact-element","target":ID,"kind":"type","text":"..."},
 {"action":"select-option","target":ID,"value":"..."},
 {"action":"set-checkbox","target":ID,"checked":true},
 {"action":"press-key","target":ID,"key":"Enter"},
 {"action":"submit-form","target":ID},
 {"action":"wait","ms":800}
]}

Règles :
- 12 étapes maximum. Les "target" sont les ids fournis dans "elements".
- Déplace-toi vers un élément (walk/jump) AVANT d'interagir avec lui — c'est plus vivant.
- Intercale des "emote" et des "say" courts pour donner de la personnalité.
- N'enchaîne des actions sur la page que si l'utilisateur a demandé une action. Chaque interaction sensible demandera confirmation.
- "navigate" change d'URL ; "go-back/go-forward" parcourent l'historique ; "scroll-by" défile de "dy" pixels.
- "select-option" choisit dans un menu ; "set-checkbox" coche/décoche ; "press-key" envoie une touche (ex. Enter) ; "submit-form" valide le formulaire de l'élément ; "wait" patiente.
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

// ---------- Mémoire de session (continuité entre onglets) ----------
function getMemory() {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage.session) return resolve([]);
      chrome.storage.session.get({ mem: [] }, (v) => resolve(v.mem || []));
    } catch (_) { resolve([]); }
  });
}
function pushMemory(entry) {
  try {
    if (!chrome.storage.session) return;
    chrome.storage.session.get({ mem: [] }, (v) => {
      const mem = (v.mem || []).concat(entry).slice(-12);
      chrome.storage.session.set({ mem });
    });
  } catch (_) { /* ignore */ }
}
function summarize(result) {
  if (result.reply) return 'a répondu';
  const steps = result.steps || [];
  const acts = steps.filter((s) => s.action !== 'say' && s.action !== 'emote').map((s) => s.action);
  if (acts.length) return acts.join(', ');
  const said = steps.find((s) => s.action === 'say');
  return said ? 'a dit: ' + String(said.text || '').slice(0, 50) : 'a parlé';
}

/** Capture l'onglet visible → base64 JPEG (ou null si impossible). */
function captureTab(windowId) {
  return new Promise((resolve) => {
    try {
      const cb = (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) return resolve(null);
        const i = dataUrl.indexOf(',');
        resolve(i >= 0 ? dataUrl.slice(i + 1) : null);
      };
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 50 }, cb);
    } catch (_) { resolve(null); }
  });
}

/** Extraction JSON tolérante (le modèle peut entourer de ```json …). */
function extractJSON(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

async function callClaude(msg, settings, memory, screenshotB64) {
  const payload = {
    intent: msg.text,
    page: { title: msg.pageTitle, url: msg.url },
    snapshot: msg.snapshot || null,
    memory: memory && memory.length ? memory : undefined
  };

  const content = [{ type: 'text', text: JSON.stringify(payload) }];
  if (screenshotB64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: screenshotB64 }
    });
  }

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
      messages: [{ role: 'user', content }]
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
  if (text.trim()) return { reply: text.trim().slice(0, 300), emotion: 'talking' };
  return { reply: 'Je n’ai rien trouvé à dire, c’est gênant.', emotion: 'thinking' };
}

/** Mode hors-ligne (pas de clé API). */
function stubReply(text, pageTitle) {
  const t = (text || '').toLowerCase();
  if (/bonjour|salut|coucou|hello/.test(t))
    return { reply: 'Salut ! Je suis Pixel, je vis dans cette page. Dis-moi ce que tu cherches !', emotion: 'happy' };
  if (/qui es[- ]tu|t'es qui|ton nom/.test(t))
    return { reply: "Je suis Pixel ! Je saute de bouton en bouton pour t'aider.", emotion: 'happy' };
  if (/page|site/.test(t))
    return { reply: `On est sur « ${pageTitle || 'cette page'} ». Je peux m'y promener si tu veux !`, emotion: 'talking' };
  if (/merci/.test(t))
    return { reply: 'Avec plaisir ! Je retourne me promener.', emotion: 'happy' };
  return { reply: "Pour me donner un vrai cerveau, ajoute une clé API Anthropic dans ma popup de configuration !", emotion: 'thinking' };
}

async function handleIntent(msg, sender) {
  const settings = await getAllSettings();
  if (!settings.apiKey) return stubReply(msg.text, msg.pageTitle);
  try {
    const memory = await getMemory();
    let shot = null;
    const windowId = sender && sender.tab ? sender.tab.windowId : undefined;
    if (settings.vision && windowId != null && !msg.proactive) {
      shot = await captureTab(windowId);
    }
    const result = await callClaude(msg, settings, memory, shot);
    if (!msg.proactive) {
      pushMemory({ title: (msg.pageTitle || '').slice(0, 60), url: (msg.url || '').slice(0, 100), intent: (msg.text || '').slice(0, 80), did: summarize(result) });
    }
    return result;
  } catch (e) {
    console.error(e);
    return { reply: 'Impossible de joindre mon cerveau : ' + (e.message || 'erreur réseau') + '.', emotion: 'sad' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'USER_INTENT') {
    handleIntent(msg, sender).then(sendResponse);
    return true; // réponse asynchrone
  }
  if (msg && msg.type === 'GET_SETTINGS') {
    getAllSettings().then(sendResponse);
    return true;
  }
  return false;
});
