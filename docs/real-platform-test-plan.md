# Plan De Test Plateformes Reelles

Ce document sert a valider StreamVolume Guard sur les sites reels utilises par les streamers. Il complete la page de test locale : la page locale prouve le comportement technique, les sites reels prouvent l'interet en condition d'usage.

## Objectif

Verifier que StreamVolume Guard aide vraiment a garder un volume navigateur stable sans rendre le son desagreable.

## Priorite De Test

1. YouTube : videos longues, Shorts, changement de video.
2. Twitch : live, clip, VOD.
3. TikTok web : videos courtes avec variations rapides.
4. Kick : live et changement de stream.
5. Spotify web : lecteur complexe, a tester avec `Capture onglet` si besoin.
6. Deezer web : lecteur complexe, a tester avec `Capture onglet` si besoin.

## Conditions A Noter

Pour chaque test :

- navigateur ;
- version du navigateur ;
- systeme ;
- version de StreamVolume Guard ;
- site teste ;
- profil utilise ;
- volume moyen voulu ;
- source active : media HTML ou capture onglet ;
- OBS utilise : oui / non ;
- casque ou enceintes ;
- probleme reproductible : oui / non.

## Scenario Minimal Par Site

- [ ] Ouvrir le site.
- [ ] Lancer un contenu calme.
- [ ] Activer StreamVolume Guard sur l'onglet.
- [ ] Verifier que la popup detecte le media ou indique la source active.
- [ ] Ecouter 30 secondes.
- [ ] Passer a un contenu plus fort.
- [ ] Verifier que le son ne saute pas brutalement.
- [ ] Passer a un contenu plus faible.
- [ ] Verifier que le son remonte sans devenir plus fort que le reste.
- [ ] Changer de video, de live ou de piste.
- [ ] Verifier que le pipeline reste actif.
- [ ] Tester ON/OFF.
- [ ] Tester Panic sur un passage fort.
- [ ] Exporter un diagnostic JSON si le comportement semble anormal.

## Validation OBS

Pour un test streamer :

- [ ] Capturer le navigateur dans OBS.
- [ ] Utiliser le profil `OBS recommande`.
- [ ] Garder la voix comme reference principale.
- [ ] Verifier que le navigateur reste sous la voix.
- [ ] Verifier que les pics ne partent pas brutalement dans le rouge.
- [ ] Verifier que le son faible ne reste pas enterre apres un son tres fort.
- [ ] Noter le niveau approximatif observe dans OBS.

## Critere Pour Dire Que C'Est Bon

Le test est considere positif si :

- le volume semble plus stable qu'en brut ;
- le son faible finit au meme niveau percu que le son fort ;
- le son tres fort ne chute pas trop bas apres reduction ;
- il n'y a pas de coupure durable ;
- il n'y a pas de pompage evident ;
- la popup indique un etat coherent ;
- le diagnostic local suffit a comprendre un bug eventuel.

## Resultat A Reporter

Utiliser ce format :

```text
Site :
Navigateur :
Systeme :
Profil :
Source active :
OBS utilise :
Resultat audio :
Probleme detecte :
Diagnostic joint :
Conclusion : valide / a revoir
```
