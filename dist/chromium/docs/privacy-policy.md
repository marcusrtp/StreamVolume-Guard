# Politique De Confidentialite - StreamVolume Guard

Derniere mise a jour : 27 juin 2026

StreamVolume Guard est une extension open source concue pour aider les streamers a stabiliser le volume audio du navigateur. Le projet est pense privacy-first : aucun tracker, aucune telemetrie automatique et aucune collecte d'audio.

## Resume

- Aucun compte utilisateur.
- Aucun serveur obligatoire.
- Aucun tracker.
- Aucune publicite.
- Aucun envoi automatique de logs.
- Aucun enregistrement audio.
- Aucun historique de navigation collecte.

## Donnees Traitees Localement

L'extension peut lire et stocker localement :

- le profil actif ;
- le volume moyen voulu ;
- le boost maximum ;
- la reduction maximum ;
- l'etat des options audio ;
- les domaines exclus ;
- les domaines en activation automatique ;
- les profils personnalises par domaine ;
- les preferences locales de l'utilisateur.

Ces donnees restent dans le stockage local du navigateur via `chrome.storage.local` ou l'equivalent du navigateur.

## Audio

Le traitement audio est effectue localement dans le navigateur avec la Web Audio API.

StreamVolume Guard :

- analyse le niveau audio localement ;
- applique un gain automatique localement ;
- affiche des diagnostics locaux ;
- ne copie pas l'audio ;
- ne sauvegarde pas l'audio ;
- n'envoie pas l'audio a un serveur.

## Diagnostics

La popup et la page Options peuvent afficher ou exporter un diagnostic local.

Ce diagnostic peut inclure :

- la version de l'extension ;
- la langue du navigateur ;
- le type de navigateur ;
- le domaine actif, sans URL complete ;
- les reglages audio principaux ;
- le nombre de medias detectes et traites ;
- la source active ;
- les niveaux gain / RMS / peak ;
- le dernier message d'erreur technique.

Le diagnostic n'est jamais envoye automatiquement. L'utilisateur doit l'exporter ou le copier volontairement.

Le diagnostic n'inclut pas :

- l'audio ;
- l'historique de navigation ;
- l'URL complete ;
- le titre de page ;
- un compte utilisateur ;
- un jeton d'acces ;
- une adresse e-mail ;
- une donnee personnelle volontairement collectee.

## Permissions

StreamVolume Guard demande uniquement les permissions necessaires au MVP :

- `activeTab` pour agir sur l'onglet choisi par l'utilisateur ;
- `scripting` pour injecter les scripts de traitement dans l'onglet actif ;
- `storage` pour sauvegarder les reglages localement ;
- `tabCapture` et `offscreen` uniquement dans le build Chromium, pour le fallback manuel `Capture onglet`.

Les builds Firefox, Firefox Android et Safari source retirent les permissions `tabCapture` et `offscreen`.

## Services Tiers

La V1 ne depend d'aucun service tiers pour fonctionner.

Les plateformes comme YouTube, Twitch, TikTok, Kick, Spotify ou Deezer restent responsables de leurs propres traitements et politiques de confidentialite. StreamVolume Guard ne controle pas ces services.

## Publication Open Source

Le code source est lisible et non obfusque. Les testeurs peuvent inspecter le projet, les builds `dist/` et les fichiers de release.

## Contact Et Retours

Pour signaler un bug, utiliser le depot GitHub ou le modele dans `docs/bug-report-template.md`.

Avant de partager un diagnostic, verifier qu'il ne contient pas d'information privee ajoutee manuellement par erreur.
