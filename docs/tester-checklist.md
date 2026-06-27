# Checklist Testeur - StreamVolume Guard

Cette checklist sert à tester StreamVolume Guard proprement et à envoyer un retour utile si quelque chose ne fonctionne pas.

Important : StreamVolume Guard ne collecte pas de logs automatiquement. Le diagnostic JSON est généré localement et doit être exporté puis partagé volontairement par le testeur.

## 1. Avant De Commencer

- [ ] Noter le navigateur utilisé : Chrome, Brave, Edge, Firefox ou autre.
- [ ] Noter la version du navigateur si possible.
- [ ] Noter le système : Windows, macOS, Linux, Android ou iOS/iPadOS.
- [ ] Noter la version de StreamVolume Guard testée.
- [ ] Vérifier que l'extension vient du dépôt GitHub officiel ou d'un build partagé par le mainteneur.
- [ ] Fermer les autres extensions audio si possible pour éviter les conflits.
- [ ] Utiliser un casque ou les mêmes enceintes que pendant un live.
- [ ] Garder le volume système et navigateur à un niveau normal, pas extrêmement bas ou extrêmement haut.

## 2. Installation

### Chrome, Brave Ou Edge Desktop

- [ ] Télécharger ou ouvrir le dossier du projet.
- [ ] Utiliser le dossier :

```text
chemin vers StreamVolume Guard\dist\chromium
```

- [ ] Ouvrir la page des extensions :

```text
chrome://extensions
brave://extensions
edge://extensions
```

- [ ] Activer le mode développeur.
- [ ] Cliquer sur `Load unpacked`.
- [ ] Sélectionner le dossier `dist\chromium`.
- [ ] Épingler l'extension dans la barre du navigateur.

### Firefox Desktop

- [ ] Utiliser le dossier :

```text
chemin vers StreamVolume Guard\dist\firefox
```

- [ ] Ouvrir :

```text
about:debugging#/runtime/this-firefox
```

- [ ] Cliquer sur `Load Temporary Add-on`.
- [ ] Sélectionner `dist\firefox\manifest.json`.
- [ ] Comprendre que ce chargement est temporaire pour les tests.

### Safari

- [ ] Ne pas annoncer Safari comme support final sans test réel.
- [ ] Utiliser un Mac avec Xcode.
- [ ] Partir de :

```text
chemin vers StreamVolume Guard\dist\safari-source
```

- [ ] Convertir ou ouvrir la source comme Safari Web Extension avec Xcode.
- [ ] Tester sur de vrais sites audio/vidéo avant tout retour public.

## 3. Premier Test Simple

- [ ] Ouvrir une page avec une vidéo ou de l'audio.
- [ ] Cliquer sur l'icône StreamVolume Guard.
- [ ] Choisir le profil `Stream` ou `OBS recommandé`.
- [ ] Cliquer sur `Activer cet onglet`.
- [ ] Vérifier que la popup affiche le site actuel.
- [ ] Vérifier que des médias sont détectés.
- [ ] Vérifier que le pipeline est actif.
- [ ] Vérifier que l'état streamer affiche `Safe`, `À surveiller` ou `Risque`.
- [ ] Lancer une vidéo et écouter au moins 30 secondes.

## 4. Page De Test Locale

Si Node est disponible :

```powershell
cd "chemin vers StreamVolume Guard"
node tests/start-local-server.js
```

Puis ouvrir l'URL affichée, par exemple :

```text
http://127.0.0.1:8787/test-page.html
```

À tester :

- [ ] Tester `Son faible`.
- [ ] Tester `Son fort`.
- [ ] Tester `Son très fort` à volume système raisonnable.
- [ ] Activer l'extension sur l'onglet.
- [ ] Retester `Son faible`, `Son fort` et `Son très fort`.
- [ ] Tester `Avant brut`, puis `Avec extension` dans la démo avant / après.
- [ ] Vérifier que les sons forts baissent rapidement.
- [ ] Vérifier que les sons faibles remontent progressivement.
- [ ] Vérifier que le son ne pompe pas de façon gênante.
- [ ] Vérifier qu'il n'y a pas de distorsion évidente.
- [ ] Vérifier que le compteur de pics contenus augmente quand un son très fort arrive.

## 5. Tests Sur Sites Réels

Pour une validation plus structurée, utiliser aussi :

```text
docs/real-platform-test-plan.md
```

Tester au minimum :

- [ ] YouTube.
- [ ] Twitch.
- [ ] TikTok web.
- [ ] Kick.
- [ ] Une page avec vidéo intégrée.

Pour chaque site :

- [ ] Activer l'extension sur l'onglet.
- [ ] Noter le profil utilisé.
- [ ] Écouter un passage calme.
- [ ] Écouter un passage fort.
- [ ] Changer de vidéo ou de stream.
- [ ] Vérifier que le volume semble plus stable qu'avant.
- [ ] Vérifier que les voix restent naturelles.
- [ ] Vérifier que la musique n'est pas écrasée.
- [ ] Vérifier que l'extension ne coupe pas la lecture.
- [ ] Vérifier que l'état streamer réagit vite en cas de pic fort.
- [ ] Sur Chrome, Brave ou Edge, tester le bouton `Capture onglet` si aucun média n'est détecté ou si le son n'est pas traité.
- [ ] Tester Spotify web et Deezer web avec `Capture onglet` sur Chromium desktop.
- [ ] Vérifier que la popup indique correctement la source active : média HTML ou capture onglet.

## 6. Tests Pour Streamers Et OBS

- [ ] Capturer le navigateur dans OBS avec le même type de source que pendant un live.
- [ ] Utiliser le profil `OBS recommandé`.
- [ ] Garder la voix comme référence principale du mix.
- [ ] Surveiller le vumètre OBS pendant un son fort.
- [ ] Vérifier que le navigateur ne part pas brutalement dans le rouge.
- [ ] Vérifier que le navigateur ne devient pas trop bas après un pic.
- [ ] Tester une alerte, une musique et une vidéo si possible.
- [ ] Noter si StreamVolume Guard aide réellement à éviter de toucher au volume pendant le live.
- [ ] Utiliser la page de test locale pour jouer `Son faible`, `Son fort` et `Son très fort` pendant qu'OBS capture le navigateur.
- [ ] Vérifier que le son très fort ne met pas le mix OBS brutalement dans le rouge.
- [ ] Tester le bouton Panic pendant un son fort, puis le désactiver.

## 7. Tests De Réglages

- [ ] Activer puis désactiver l'extension depuis la popup.
- [ ] Changer de profil : Doux, Normal, Stream, OBS recommandé, Nuit.
- [ ] Vérifier sur YouTube, Twitch, TikTok, Kick, Spotify web ou Deezer web que le profil recommandé est logique.
- [ ] Modifier le profil dans la popup et vérifier qu'il reste appliqué au domaine après rechargement.
- [ ] Vérifier que le profil Stream protège davantage que Normal.
- [ ] Vérifier que Nuit est plus calme.
- [ ] Ajouter un domaine en activation automatique.
- [ ] Recharger la page et vérifier que l'activation automatique fonctionne.
- [ ] Ajouter un domaine exclu.
- [ ] Vérifier que le domaine exclu n'est pas traité.
- [ ] Retirer le domaine exclu et retester.

## 8. Signes D'Un Bug À Reporter

Reporter un bug si :

- [ ] Aucun média n'est détecté alors que la page joue bien un son.
- [ ] Le pipeline reste inactif après activation.
- [ ] Le son devient beaucoup trop faible sans revenir.
- [ ] Le son devient trop fort malgré l'extension.
- [ ] Le son pompe fortement.
- [ ] Le son sature ou craque.
- [ ] Le ON/OFF coupe définitivement l'audio.
- [ ] Le compteur de pics semble incohérent.
- [ ] Une erreur apparaît dans la popup ou la page Options.
- [ ] L'extension ne fonctionne plus après changement de vidéo.

## 9. Informations À Joindre Au Retour

Copier ces informations dans le message de bug :

```text
Version de StreamVolume Guard :
Navigateur :
Version du navigateur :
Système :
Site testé :
Profil utilisé :
Activation manuelle ou automatique :
Domaine exclu : oui / non
Médias détectés dans la popup :
Source active : média HTML / capture onglet / aucune
Panic actif : oui / non
Pipeline actif : oui / non
État streamer : Safe / À surveiller / Risque
Pics contenus affichés :
Ce qui s'est passé :
Ce qui était attendu :
Est-ce reproductible : oui / non
```

Ne pas partager de données privées : compte utilisateur, jeton d'accès, adresse de contact, URL privée, page d'administration, contenu personnel ou information confidentielle.

## 10. Exporter Le Diagnostic JSON Local

Le diagnostic JSON est le fichier principal à joindre quand un bug est difficile à comprendre.

Étapes :

- [ ] Ouvrir la page où le bug se produit.
- [ ] Activer StreamVolume Guard sur l'onglet.
- [ ] Reproduire le problème.
- [ ] Ouvrir la page Options de l'extension.

Méthodes possibles :

- clic droit sur l'icône StreamVolume Guard, puis `Options` ;
- ou page extensions du navigateur, puis détails de StreamVolume Guard, puis options de l'extension.

Ensuite :

- [ ] Trouver la section de diagnostic local.
- [ ] Cliquer sur `Exporter le diagnostic JSON` si le mainteneur a besoin du fichier complet.
- [ ] Garder le fichier généré, par exemple :

```text
streamvolume-guard-diagnostic-site-date.json
```

- [ ] Joindre ce fichier au retour de bug si le canal de discussion l'autorise.
- [ ] Si le fichier ne peut pas être joint, copier son contenu dans un bloc de code.

Ce fichier ne contient pas l'audio, pas l'historique de navigation et pas de télémétrie automatique. Il est généré localement puis partagé seulement si le testeur le décide.

## 11. Logs Console Optionnels

À faire seulement si le mainteneur le demande.

### Console De La Page

- [ ] Ouvrir la page où le bug se produit.
- [ ] Appuyer sur `F12`.
- [ ] Ouvrir l'onglet `Console`.
- [ ] Reproduire le bug.
- [ ] Copier uniquement les erreurs liées à StreamVolume Guard ou à l'audio.
- [ ] Masquer toute donnée privée avant partage.

### Logs De L'Extension Chromium

Sur Chrome, Brave ou Edge :

- [ ] Ouvrir `chrome://extensions`, `brave://extensions` ou `edge://extensions`.
- [ ] Activer le mode développeur.
- [ ] Trouver StreamVolume Guard.
- [ ] Cliquer sur le lien d'inspection du service worker ou de la vue d'extension si disponible.
- [ ] Ouvrir `Console`.
- [ ] Reproduire le bug.
- [ ] Copier les erreurs pertinentes.
- [ ] Ne pas partager de donnée privée.

## 12. Format De Retour Recommandé

```text
Résumé :
Site testé :
Navigateur + version :
Système :
Profil :
Étapes pour reproduire :
Résultat obtenu :
Résultat attendu :
Diagnostic JSON joint : oui / non
Diagnostic popup copié : oui / non
Logs console joints : oui / non
Capture d'écran jointe : oui / non
```

Un bon retour n'a pas besoin d'être long. Il doit surtout permettre de reproduire le problème.

## 13. Critères Pour Dire Que Le Test Est Bon

Le test est considéré utile si :

- [ ] Au moins un site réel a été testé.
- [ ] La page de test locale a été testée si possible.
- [ ] Le profil utilisé est noté.
- [ ] Le résultat audio est décrit avec des mots simples.
- [ ] Les bugs sont accompagnés d'un diagnostic JSON quand c'est possible.
- [ ] Les limites ou incompatibilités sont décrites honnêtement.
