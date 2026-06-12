# Compagnon — mascotte vocale et agentique

Extension Chrome/Firefox : une mascotte 2D (« Pixel ») qui vit dans la page, marche et saute sur les éléments HTML comme sur des plateformes, parle à voix haute avec une bouche synchronisée, et vous écoute via push-to-talk.

**v2 — couche agentique branchée.** La mascotte est maintenant pilotée par l'API Anthropic : votre intention vocale + un snapshot structuré du DOM partent vers Claude, qui retourne une séquence d'actions (se déplacer, sauter, lire, cliquer, remplir) exécutée physiquement dans la page, avec confirmation avant chaque action sensible. Sans clé API, elle reste en mode hors-ligne (elle parle mais ne réfléchit pas). Reste à venir : la mémoire de session entre onglets.

## Installation

### Chrome / Edge / Brave
1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (coin haut droit)
3. **Charger l'extension non empaquetée** → choisir le dossier `extension/`

### Firefox
1. Ouvrir `about:debugging#/runtime/this-firefox`
2. **Charger un module complémentaire temporaire** → choisir `extension/manifest.json`

Note : Firefox ne supporte pas `SpeechRecognition` — le bouton micro y est masqué automatiquement. La synthèse vocale fonctionne partout.

## Tester

Ouvrir `demo/demo.html` dans le navigateur (l'extension doit avoir accès aux fichiers locaux : cocher « Autoriser l'accès aux URL de fichier » dans les détails de l'extension sur Chrome). La page contient cartes, escaliers, formulaires et un bouton qui disparaît pour tester la chute.

Interactions :
- **Clic** sur la mascotte → elle réagit
- **Glisser-lâcher** → on l'attrape et on la lance, elle retombe sur une plateforme
- **Survol → maintenir 🎤** → push-to-talk : la transcription + le snapshot DOM partent vers Claude, qui retourne une séquence d'actions jouée dans la page
- **Popup de l'extension** → clé API Anthropic, choix du modèle (Haiku/Sonnet), prompt système (personnalité, rôle, contraintes — injecté en tête de chaque appel), voix, et **permissions par site** : cliquer, remplir, soumettre, ouvrir des liens, défiler, lire à voix haute. Coché = sans confirmation ; sinon la mascotte demande « je vais cliquer sur X — ok ? » avant chaque action.

Exemples à dire au micro sur la page de démo (avec clé API) : « lis-moi le formulaire », « remplis le champ nom avec Pixel », « clique sur le premier bouton », « va sur l'escalier ».

## Architecture

```
extension/
├── manifest.json        MV3 cross-browser (service_worker Chrome + scripts Firefox)
├── background.js        Réglages + cerveau IA : appel api.anthropic.com, prompt harnais
│                        (format JSON des actions) + prompt système utilisateur,
│                        parsing tolérant, mode hors-ligne sans clé
├── content/
│   ├── physics.js       Moteur physique : plateformes = getBoundingClientRect des
│   │                    éléments visibles, gravité, collision bord supérieur,
│   │                    sauts paraboliques calculés, plateforme qui disparaît → chute
│   ├── sprite.js        Personnage canvas 100 % procédural : cycle de marche,
│   │                    squash & stretch, clignement, émotions, bouche à amplitude variable
│   ├── voice.js         SpeechSynthesis (voix/langue/débit/timbre configurables,
│   │                    amplitude bouche estimée) + SpeechRecognition push-to-talk
│   ├── perception.js    Snapshot DOM structuré pour l'IA : éléments interactifs
│   │                    (id, label, rect), erreurs visibles, modales, chargement
│   ├── actions.js       Exécuteur de séquences : walk-to-target, jump-to-platform,
│   │                    read-element, scroll-to, interact-element (clic/frappe) ;
│   │                    permissions par site + boîte de confirmation visuelle
│   ├── main.js          Boucle requestAnimationFrame, comportements, bulle, drag &
│   │                    lancer, hooks promisifiés (walkTo/jumpToRect) pour l'exécuteur
│   └── mascot.css       Bulle, hitbox, micro, boîte de confirmation (.mascot-ui)
├── popup/               Clé API, modèle, prompt système, voix, permissions par site
demo/
└── demo.html            Niveau de test : escaliers, cartes, formulaire, bouton qui disparaît
```

## Format des actions retournées par l'IA

```json
{"steps":[
 {"action":"say","text":"Je m'en occupe !","emotion":"happy"},
 {"action":"jump-to-platform","target":12},
 {"action":"interact-element","target":12,"kind":"click"},
 {"action":"interact-element","target":7,"kind":"type","text":"Bonjour"},
 {"action":"read-element","target":3},
 {"action":"emote","emotion":"happy","duration":1500}
]}
```

Les `target` sont les ids du snapshot. Catégories de permission : `click`, `fill`,
`submit`, `open`, `scroll`, `read` — stockées par origine dans `chrome.storage.local`
(`perm:<origin>`). Refus ou délai de 15 s = séquence annulée.

## Prochaine étape : mémoire de session

Le background voit déjà passer tous les échanges — y maintenir un résumé
(pages visitées, actions faites, préférences) injecté dans chaque appel API
pour donner de la continuité entre onglets.

## Réglages physiques utiles (`physics.js`)

`GRAVITY` (2600 px/s²), `WALK_SPEED` (dans `main.js`, 130 px/s), `MAX_PLATFORMS` (250), tolérance de bord `EDGE_TOL` (6 px). Marquer un élément `data-mascot-platform` le rend plateforme même s'il n'est pas dans la liste de sélecteurs.
