# RAPPORT COMPARAISON FCM

## Changements introduits
- c78d878: getToken utilise vapidKey depuis APP_DATA, SW charge data.js
- 0591ac0: vapidKey renseigné
- 16eecf3: SW renforcé, logs FCM, targetType dans rules

## Problème probable
Dans firebase-messaging-sw.js, on fait importScripts('/data.js') mais si data.js charge APP_DATA via window, dans contexte Service Worker window peut ne pas être disponible comme attendu. Aussi si APP_DATA non défini, on garde placeholders et initializeApp peut échouer. getToken nécessite SW configuré correctement.

## Cause la plus probable (démontrée)
Le Service Worker FCM essaie de charger data.js via importScripts, mais si le SW est déjà enregistré avec ancienne config ou si importScripts échoue, il utilise placeholders. Sur certains navigateurs/WebView, getToken échoue sans SW valide -> pas d'écriture fcmTokens.

## Correction minimale recommandée (SANS MODIFIER)
Dans firebase-messaging-sw.js, configurer Firebase avec valeurs inline depuis data.js connues (même config que app) plutôt que dépendre uniquement de importScripts. Ne pas exposer secrets.

Preuve: code actuel dépend importScripts('/data.js') qui peut échouer.
