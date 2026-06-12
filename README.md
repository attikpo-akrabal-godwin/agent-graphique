# Compagnon — mascotte vocale et agentique

Extension Chrome/Firefox : une mascotte 2D (« Pixel ») qui vit dans la page, marche et saute sur les éléments HTML comme sur des plateformes, parle à voix haute avec une bouche synchronisée, vous écoute via push-to-talk et discute par chat.

**v3 — vision, mémoire et automatisation.** La mascotte est pilotée par l'API Anthropic : votre intention (voix ou chat) part vers Claude avec un snapshot structuré du DOM **et une capture d'écran de la page** (vision), et Claude retourne une séquence d'actions exécutée physiquement dans la page, avec confirmation avant chaque action sensible. Elle garde une **mémoire de session** (pages visitées, actions, préférences) injectée dans chaque appel pour la continuité entre onglets, et réagit **proactivement** aux erreurs et fenêtres qui apparaissent. Sans clé API, elle reste en mode hors-ligne (elle parle mais ne réfléchit pas).

> Une seconde architecture expérimentale vit dans `agent-react/` : un backend Node + Playwright qui pilote un vrai Chromium, avec l'agent réécrit en React. Voir `agent-react/README.md`. L'extension reste l'implémentation principale (elle tourne dans votre onglet réel, avec vos sessions).

## Installation

### Chrome / Edge / Brave
1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (coin haut droit)
3. **Charger l'extension non empaquetée** → choisir le dossier `extension/`

### Firefox
1. Ouvrir `about:debugging#/runtime/this-firefox`
2. **Charger un module complémentaire temporaire** → choisir `extension/manifest.json`

Note : Firefox ne supporte pas `SpeechRecognition` — le bouton micro y est masqué automatiquement. La synthèse vocale fonctionne partout. La vision (capture d'écran) utilise `chrome.tabs.captureVisibleTab`.

## Tester

Ouvrir `demo/demo.html` dans le navigateur (l'extension doit avoir accès aux fichiers locaux : cocher « Autoriser l'accès aux URL de fichier » dans les détails de l'extension sur Chrome). La page contient cartes, escaliers, formulaires et un bouton qui disparaît pour tester la chute.

Interactions :
- **Clic** sur la mascotte → elle réagit
- **Glisser-lâcher** → on l'attrape et on la lance, elle retombe sur une plateforme
- **Survol → maintenir 🎤** → push-to-talk : la transcription + le snapshot DOM + une capture d'écran partent vers Claude, qui retourne une séquence d'actions jouée dans la page
- **Bouton 💬 (coin bas droit) → fenêtre de chat** : on tape une instruction et on l'envoie (Entrée ou ➤). Même pipeline que la voix. Le fil affiche tes messages et les réponses, avec un indicateur « … » pendant qu'elle réfléchit.
- **Réactions proactives** : quand une erreur ou une fenêtre apparaît, la mascotte le remarque seule et propose son aide (désactivable dans la popup).
- **Popup de l'extension** → clé API Anthropic, modèle (Haiku/Sonnet), prompt système (personnalité), voix, interrupteurs **vision** et **réactions proactives**, et **permissions par site** : cliquer, remplir, soumettre, ouvrir/naviguer, défiler, lire. Coché = sans confirmation ; sinon la mascotte demande « je vais cliquer sur X — ok ? » avant chaque action.

Exemples (voix ou chat, avec clé API) : « lis-moi le formulaire », « remplis le champ nom avec Pixel », « clique sur le premier bouton », « va sur wikipedia.org », « coche la case conditions », « choisis France dans le menu pays ».

## Architecture

```
extension/
├── manifest.json        MV3 cross-browser (service_worker Chrome + scripts Firefox)
├── background.js        Réglages + cerveau IA : appel api.anthropic.com avec capture
│                        d'écran (vision) + mémoire de session, prompt harnais (format
│                        JSON des actions) + prompt système, mode hors-ligne sans clé
├── content/
│   ├── physics.js       Moteur physique : plateformes = rects des éléments visibles,
│   │                    gravité, collision bord supérieur, sauts paraboliques
│   ├── sprite.js        Personnage canvas 100 % procédural : marche, squash & stretch,
│   │                    clignement, émotions, bouche à amplitude variable
│   ├── voice.js         SpeechSynthesis + SpeechRecognition push-to-talk
│   ├── perception.js    Snapshot DOM structuré + signals() (erreurs/modales) pour le proactif
│   ├── actions.js       Exécuteur : walk/jump, read, scroll-to/by, hover, navigate,
│   │                    go-back/forward, interact (clic/frappe), select-option,
│   │                    set-checkbox, press-key, submit-form, wait + permissions/confirmation
│   ├── chat.js          Fenêtre de chat texte (bouton 💬, fil, indicateur de saisie)
│   ├── main.js          Boucle rAF, comportements, bulle, drag, chat, réactions proactives
│   └── mascot.css       Bulle, hitbox, micro, confirmation, panneau de chat (.mascot-ui)
├── popup/               Clé API, modèle, prompt système, voix, vision, proactif, permissions
demo/
└── demo.html            Niveau de test : escaliers, cartes, formulaire, bouton qui disparaît

agent-react/             Variante expérimentale Playwright + React (voir son README)
```

## Format des actions retournées par l'IA

```json
{"steps":[
 {"action":"say","text":"Je m'en occupe !","emotion":"happy"},
 {"action":"walk-to-target","target":12},
 {"action":"interact-element","target":12,"kind":"click"},
 {"action":"interact-element","target":7,"kind":"type","text":"Bonjour"},
 {"action":"select-option","target":9,"value":"France"},
 {"action":"set-checkbox","target":5,"checked":true},
 {"action":"navigate","url":"https://example.com"},
 {"action":"read-element","target":3},
 {"action":"emote","emotion":"happy","duration":1500}
]}
```

Actions disponibles : `say`, `emote`, `walk-to-target`, `jump-to-platform`, `read-element`,
`scroll-to`, `scroll-by`, `hover`, `navigate`, `go-back`, `go-forward`, `interact-element`
(`click`/`type`), `select-option`, `set-checkbox`, `press-key`, `submit-form`, `wait`.

Les `target` sont les ids du snapshot. Catégories de permission : `click`, `fill`,
`submit`, `open`, `scroll`, `read` — stockées par origine dans `chrome.storage.local`
(`perm:<origin>`). Refus ou délai de 15 s = séquence annulée.

## Mémoire de session

`background.js` maintient dans `chrome.storage.session` un résumé glissant des derniers
échanges (titre de page, URL, intention, actions faites), injecté dans le champ `memory`
de chaque appel pour donner de la continuité entre onglets. Effacé à la fermeture du navigateur.

## Réglages physiques utiles (`physics.js`)

`GRAVITY` (2600 px/s²), `WALK_SPEED` (dans `main.js`, 130 px/s), `MAX_PLATFORMS` (250), tolérance de bord `EDGE_TOL` (6 px). Marquer un élément `data-mascot-platform` le rend plateforme même s'il n'est pas dans la liste de sélecteurs.
