# StreamVolume Guard

StreamVolume Guard aide les streamers à éviter les pics audio et les écarts de volume entre YouTube, Twitch, TikTok, Kick et les autres sites vidéo.

L'extension est open source, sans tracker et sans collecte de données : aucune donnée n'est récupérée, et le traitement audio reste local sur la machine de l'utilisateur.

Sa promesse est simple : réduire les écarts de volume afin qu'un son trop fort ne surprenne pas le streamer, le chat ou les viewers pendant un live.

## Dernière Version

Version actuelle : `0.1.3`.

Statut : MVP technique (version minimale viable) prêt pour tests manuels, retours streamers et partage GitHub.

Pourquoi cette version existe : valider une normalisation audio locale, open source et sans tracker, avant d'ajouter des fonctions plus avancées.

Voir `CHANGELOG.md` pour comprendre rapidement ce qui a changé et pourquoi.

Notes de release prêtes à publier :

```text
store/release-0.1.3.md
```

## Compatibilité Actuelle

StreamVolume Guard cible d'abord les navigateurs Chromium desktop (navigateurs de bureau basés sur Chromium) comme Chrome et Brave, mais le projet sait générer des builds séparés pour Firefox, Firefox Android et une source Safari.

Compatibilité annoncée pour la V1 :

- Chrome desktop : cible principale.
- Brave desktop : support prévu, car Brave est basé sur Chromium.
- Edge desktop : compatible à tester avec le build Chromium.
- Firefox desktop : build dédié à tester.
- Firefox Android : build dédié à tester sur vrai téléphone.
- Safari macOS : source prête à convertir avec Xcode sur Mac.
- Safari iOS/iPadOS : source prête, mais nécessite une app wrapper Safari Web Extension via Xcode.

Compatibilité non garantie pour l'instant :

- Chrome Android : non supporté officiellement.
- Opera, Vivaldi et autres navigateurs Chromium : probablement compatibles avec `dist/chromium`, mais à tester avant annonce officielle.
- Sites audio complexes qui ne passent pas par des éléments HTML `video` ou `audio` standards : utiliser le fallback manuel `Capture onglet` sur Chromium desktop.

## Fonctionnalités MVP (version minimale viable)

- Détecte les éléments HTML `video` et `audio`.
- Traite l'audio avec la Web Audio API (technologie du navigateur qui permet d'analyser et modifier l'audio localement).
- Estime le niveau RMS (niveau moyen approximatif du signal audio).
- Applique un gain automatique lissé.
- Réduit rapidement les contenus trop forts.
- Remonte lentement les contenus trop faibles.
- Ajoute un compresseur doux.
- Ajoute un limiteur de sécurité gratuit autour de `-1 dB` (`dB` veut dire décibel, une unité de niveau sonore).
- Propose cinq profils : Doux, Normal, Stream, OBS recommandé (profil pensé pour Open Broadcaster Software, souvent appelé OBS) et Nuit.
- Utilise Stream comme profil protecteur par défaut.
- Inclut une identité visuelle Guard Signal pour l'icône d'extension.
- Localise les métadonnées, la popup et les textes principaux en français et en anglais.
- Sauvegarde les réglages avec `chrome.storage.local` (stockage local fourni par Chrome pour les extensions).
- Permet d'exclure des domaines.
- Permet une activation automatique optionnelle par domaine.
- Évite de traiter deux fois le même média.
- Affiche un état streamer : Safe, À surveiller ou Risque.
- Compte les pics probablement contenus par le limiteur sur l'onglet actif.
- Affiche des diagnostics rapides : média détecté, pipeline actif, exclusions, mode Panic et source active.
- Propose un bouton Panic pour baisser immédiatement l'onglet actif si un son explose.
- Propose un fallback manuel de capture audio d'onglet sur Chromium desktop pour les sites web complexes.
- Applique des profils recommandés par plateforme, avec surcharge locale par domaine.
- Permet de copier un diagnostic local depuis la popup et d'exporter un diagnostic JSON local depuis les Options.
- Inclut license/capabilities.js comme séparation propre pour de futures capacités avancées.

## Modèle De Coût

Le MVP (version minimale viable) n'a pas de backend (serveur externe), pas de dépendance payante et pas d'étape de build (compilation avant utilisation).

Tous les réglages restent locaux. Il n'y a pas de compte utilisateur, pas de synchronisation, pas de télémétrie et pas de serveur de licence dans cette version.

## Télécharger Depuis GitHub

1. Clique sur `Code`.
2. Clique sur `Download ZIP`.
3. Décompresse le fichier ZIP.
4. Charge le dossier `dist/` adapté à ton navigateur.

Quand une release GitHub est disponible, préfère les fichiers `.zip` de la release : ils contiennent directement le build adapté au navigateur.

La release fournit aussi un zip du projet complet, par exemple `streamvolume-guard-project-0.1.3.zip`, pour récupérer le code source, la documentation, la page de test et les builds `dist/` dans une seule archive.

## Installation Dans Chrome Ou Brave

1. Ouvre `chrome://extensions`.
2. Active le mode développeur.
3. Clique sur `Load unpacked`.
4. Sélectionne le dossier de l'extension :

```text
chemin vers StreamVolume Guard\dist\chromium
```

5. Épingle StreamVolume Guard dans la barre du navigateur.
6. Ouvre une page avec de l'audio ou de la vidéo.
7. Clique sur l'icône de l'extension.
8. Clique sur `Activer cet onglet`.

Pour Brave, utilise `brave://extensions` avec les mêmes étapes.

## Installation Dans Firefox, Edge Et Safari

Sur GitHub, les dossiers `dist/` sont inclus pour permettre une installation directe sans outil de build. Si tu modifies le code source, régénère les builds :

```powershell
cd "chemin vers StreamVolume Guard"
node tools/build-targets.js
```

### Edge Desktop

1. Ouvre `edge://extensions`.
2. Active le mode développeur.
3. Clique sur `Load unpacked`.
4. Sélectionne :

```text
chemin vers StreamVolume Guard\dist\chromium
```

### Firefox Desktop

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. Clique sur `Load Temporary Add-on`.
3. Sélectionne le fichier :

```text
chemin vers StreamVolume Guard\dist\firefox\manifest.json
```

Important : cette installation Firefox est temporaire pour les tests. Pour une installation publique stable, il faudra passer par `addons.mozilla.org`.

### Firefox Android

1. Génère le build avec `node tools/build-targets.js`.
2. Utilise le dossier :

```text
chemin vers StreamVolume Guard\dist\firefox-android
```

3. Vérifie le build avec `web-ext lint --source-dir dist/firefox-android` si `web-ext` est installé.
4. Teste sur un vrai téléphone Android avec Firefox avant de promettre le support public.

### Safari macOS Et iOS/iPadOS

Le dossier Safari généré est :

```text
chemin vers StreamVolume Guard\dist\safari-source
```

Ce dossier est une source préparée, pas un package Safari final.

Avec un Mac, le test devient raisonnable :

1. Installe Xcode depuis le Mac App Store ou le site Apple Developer.
2. Ouvre ou convertis `dist/safari-source` comme Safari Web Extension dans Xcode.
3. Lance l'app générée depuis Xcode.
4. Active l'extension dans Safari.
5. Teste sur de vrais sites audio/vidéo avant d'annoncer le support Safari.

Pour une publication officielle Safari, c'est plus lourd : il faut signer l'app, préparer une fiche App Store Connect et passer par l'écosystème Apple. Un compte Apple Developer payant peut être nécessaire pour distribuer publiquement.

Conclusion : Safari est faisable si tu as un Mac, mais il ne doit pas être promis comme support final tant qu'il n'a pas été généré, signé et testé avec Xcode.

### Chrome Android

Chrome Android est non supporté officiellement pour cette V1. Ne l'annonce pas comme compatible tant qu'il n'y a pas de stratégie dédiée.

Pour une installation streamer plus rapide, utilise :

```text
docs/streamer-quickstart-60s.md
```

## Déploiement Multi-Navigateurs

Le projet peut maintenant générer des builds séparés pour Chromium, Firefox, Firefox Android et une source Safari à convertir avec Xcode :

```powershell
node tools/build-targets.js
```

Les builds prêts à installer sont dans `dist/` :

- `dist/chromium` pour Chrome, Brave et Edge desktop.
- `dist/firefox` pour Firefox desktop.
- `dist/firefox-android` pour Firefox Android.
- `dist/safari-source` pour Safari macOS et Safari iOS/iPadOS via Xcode.

Chrome Android est indiqué comme non supporté officiellement, afin d'éviter de promettre une plateforme que Google ne cible pas comme environnement d'extensions classique.

Guide complet :

```text
docs/cross-browser-deployment.md
```

## Page De Test Locale

Flux recommandé :

```powershell
cd "chemin vers StreamVolume Guard"
node tests/start-local-server.js
```

Puis ouvre l'URL affichée, par exemple :

```text
http://127.0.0.1:8787/test-page.html
```

C'est plus fiable que l'ouverture directe de `test-page.html`, car les pages `file://` demandent une permission manuelle dans Chrome.

La page de test crée un vrai élément `audio` basé sur un WAV local. Les boutons `Son faible`, `Son fort` et `Son très fort` restent volontairement dans un seul bloc pour tester rapidement les écarts sans complexifier l'interface.

Les trois niveaux gardent une vraie différence audible : `Son faible` vise environ `-63.0 dB`, `Son fort` vise environ `-43.0 dB`, et `Son très fort` vise environ `-3.0 dB`. Le très fort est volontairement beaucoup plus haut que le fort pour que l'écart soit net à l'oreille. Quand l'extension est active sur cet onglet, le bloc `Résultats extension` affiche en direct la cible, le gain appliqué, le RMS brut, la sortie estimée, le risque et les médias traités.

Pour une démo simple, commence par `Démo avant / après` : `Avant brut` contourne volontairement le traitement pour faire entendre les vrais écarts, puis `Avec extension` joue les mêmes niveaux avec le traitement actif.

Important : le profil Stream garde une limite de sécurité sur la réduction forte, mais le boost maximum par défaut monte à `+48 dB` pour que `Son faible` reste récupérable sur la page de test sans modifier les niveaux bruts.

## Réglages

La popup sert au contrôle rapide pendant un live :

- état ON/OFF ;
- site actif ;
- profil actif ;
- état Safe / À surveiller / Risque ;
- pics probablement contenus sur l'onglet actif ;
- gain actuel ;
- valeur RMS (niveau moyen approximatif du signal audio) ;
- médias détectés et traités ;
- diagnostics streamer ;
- badges local, open source et zéro tracking ;
- activation manuelle ;
- activation automatique optionnelle pour le domaine courant ;
- capture audio manuelle de l'onglet actif sur Chromium desktop ;
- mode Panic ;
- copie rapide d'un diagnostic local.

La page Options permet de gérer :

- profil actif ;
- niveau RMS cible (niveau moyen visé par la normalisation), avec slider et écoute locale de test ;
- boost maximum ;
- réduction maximum ;
- compresseur et limiteur ;
- domaines en activation automatique ;
- domaines exclus ;
- profils par plateforme avec état recommandé ou personnalisé ;
- état des capacités disponibles ;
- descriptions visibles pour comprendre chaque réglage ;
- export diagnostic JSON local.

## Profils

- Doux : normalisation plus légère.
- Normal : navigation générale.
- Stream : profil protecteur pour live.
- OBS recommandé : niveau navigateur plus calme pour laisser de la place à la voix et aux alertes dans OBS (logiciel de streaming).
- Nuit : cible plus basse pour une écoute discrète.

Stream est volontairement protecteur. Il réduit les contenus forts rapidement et remonte les contenus faibles progressivement pour éviter le pompage audible.

Pour l'onboarding streamer, commence avec le preset OBS recommandé quand le navigateur est capturé comme source dans OBS. Il vise un niveau plus calme que Stream tout en gardant une protection rapide contre les pics audio.

## Limites Connues

- Le chemin principal traite les éléments `video` et `audio` détectés.
- Le fallback `Capture onglet` utilise `chrome.tabCapture` et un document `offscreen` sur Chromium desktop. Il reste manuel et doit être validé sur de vrais sites avant promesse publique forte.
- Les builds Firefox, Firefox Android et Safari source retirent les permissions `tabCapture` et `offscreen`, car ce fallback est spécifique à Chromium dans cette V1.
- Certains sites remplacent les médias dynamiquement ; le `MutationObserver` (outil du navigateur qui détecte les changements dans la page) aide, mais ne garantit pas tous les cas.
- Les pages internes comme `chrome://` ne peuvent pas être traitées.
- Certains chemins média protégés ou atypiques peuvent échouer avec `createMediaElementSource()`.
- Après connexion d'un média à Web Audio, l'extension utilise un bypass dry/wet (mélange entre son original et son traité) pour ON/OFF, car le navigateur ne permet pas de créer un second `MediaElementAudioSourceNode` (source audio Web Audio liée à un média HTML) pour le même élément.
- Le limiteur est un limiteur de sécurité, pas un limiteur mastering transparent.
- Le compteur de pics contenus est une approximation basée sur le niveau peak (pic audio instantané) prédit avant limiteur, pas un true-peak meter professionnel (mesureur de pics audio très précis utilisé en production audio).
- La localisation couvre actuellement le français et l'anglais.
- La qualité audio doit être validée avec des tests réels sur des workflows de streamers.

## Tester Le Diagnostic

Les testeurs peuvent exporter un diagnostic JSON (format texte structuré facile à partager pour un bug) local depuis la page Options avec `Exporter le diagnostic JSON`, ou copier un diagnostic court depuis la popup.

Le fichier est généré sur la machine de l'utilisateur et doit être partagé manuellement. Il sert aux retours de bug et inclut la version de l'extension, la langue du navigateur, le user agent (identité technique du navigateur), un résumé des réglages locaux, le domaine actif, l'état de détection média, les valeurs gain/RMS/peak (gain appliqué, niveau moyen et pic audio), l'état de risque, le nombre de pics contenus et la dernière erreur d'extension.

Il n'inclut pas l'audio, le titre de page, l'URL complète, l'historique de navigation ou une télémétrie automatique.

## Confidentialité

Le MVP (version minimale viable) n'envoie aucune donnée vers un serveur.

Données stockées localement :

- profil ;
- réglages de volume cible ;
- domaines en activation automatique ;
- domaines exclus ;
- état local des capacités ;
- préférences locales de profil par domaine ;
- état local des plateformes recommandées.

Données non collectées :

- historique de navigation ;
- URL complètes pour analytics ;
- contenu audio ;
- compte utilisateur ;
- données personnelles.

## Architecture Future

Le projet reste sans build tool (outil de compilation ou de packaging) pour le MVP, mais les fichiers sont séparés pour pouvoir ajouter un bundler (outil qui regroupe les fichiers du projet) plus tard :

- `storage/` pour les réglages.
- `license/` pour les capacités.
- `audio/` pour le traitement du signal.
- `audio/stream-status.js` pour l'état streamer et les heuristiques de pics contenus.
- `popup/` pour le contrôle rapide.
- `options/` pour la configuration.
- `content.js` pour l'intégration page.
- `background.js` pour l'orchestration MV3.
- `offscreen/` pour le fallback de capture audio d'onglet Chromium.

Le mode `Capture onglet` remplace seulement la couche de source audio. Il réutilise le normalizer, les réglages et les diagnostics existants, ce qui garde la base prête pour un build tool plus tard.

## Contrôles Développeur

Depuis le dossier du projet :

```powershell
node tools/render-social-preview.js
node tools/build-targets.js
node tests/unit.test.js
node tests/build-targets.test.js
node tests/dist-packages.test.js
node tests/branding.test.js
node tests/browser-smoke.js
node --check background.js
node --check content.js
node --check popup/popup.js
node --check options/options.js
```

Aucune installation de package n'est nécessaire.

Avant de publier une version, mets à jour `manifest.json`, `CHANGELOG.md` et le bloc `Dernière Version` du README.

Pour publier une release GitHub depuis la ligne de commande, GitHub CLI doit être connecté :

```powershell
gh auth login
```

Puis créer les archives locales depuis les dossiers `dist/` avant publication. Les archives `.zip` restent ignorées par Git pour éviter de polluer l'historique, mais elles peuvent être attachées à une release GitHub.


`tools/build-targets.js` génère les dossiers `dist/chromium`, `dist/firefox`, `dist/firefox-android` et `dist/safari-source` sans dépendance externe.

`tools/render-social-preview.js` génère `assets/social-preview.png` sans dépendance externe. `assets/social-preview.html` reste une maquette lisible de la carte.

`tests/dist-packages.test.js` vérifie les dossiers prêts à installer dans `dist/` : manifests, fichiers requis, absence de dossiers développeur et syntaxe JavaScript distribuée.

`tests/browser-smoke.js` lance un navigateur Chromium (base technique de Chrome, Brave et Edge) local via Chrome DevTools Protocol (interface technique pour piloter le navigateur pendant les tests). Il cherche automatiquement Chrome, Brave ou Edge. Si ton navigateur est installé ailleurs :

```powershell
$env:WLG_CHROME_PATH="C:\Path\To\chrome.exe"
node tests/browser-smoke.js
```

Pour tester le build réellement distribué à Chrome, Brave et Edge :

```powershell
$env:WLG_EXTENSION_DIR="chemin vers StreamVolume Guard\dist\chromium"
node tests/browser-smoke.js
```

Le smoke test navigateur (test rapide qui vérifie que les fonctions critiques répondent) vérifie :

- chargement de la page de test locale ;
- détection d'un vrai média DOM ;
- traitement Web Audio ;
- réduction de gain sur signal fort ;
- absence de double traitement ;
- comportement de l'exclusion.

## Checklist Testeur Complète

Pour guider un testeur jusqu'au retour de bug complet, utilise :

```text
docs/tester-checklist.md
```

Elle couvre l'installation, les tests audio, les tests OBS, les bugs à reporter, l'export du diagnostic JSON local et les logs console optionnels.

## Roadmap D'implémentation

Les idées de prochaines fonctions sont priorisées ici :

```text
docs/future-implementation-roadmap.md
```

Le prochain gros chantier recommandé est la validation réelle du fallback `Capture onglet` sur Spotify, Deezer, Twitch, Kick et YouTube, puis le mode Speech Priority pour les contenus parlés.
