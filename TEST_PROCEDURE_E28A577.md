# PROCÉDURE DE TESTS FONCTIONNELS - e28a577 (fix/auth-sw-notif-kilo)
Date: 2026-11-01T12:26:00Z
Commit candidat: e28a577
Branche: fix/auth-sw-notif-kilo
Main: 3258ca3 (inchangée)

## 1) Connexion Google Web avec popup autorisée
**Environnement:** Navigateur web (Chrome/Firefox) - Réalisable immédiatement
**Prérequis:** Compte Google de test, cookies/sessions propres

**Étapes:**
1. Ouvrir https://ugtm-fns-souss-massa.web.app/app.html
2. Ouvrir console DevTools (Network/Auth)
3. Cliquer sur "Se connecter avec Google"
4. Autoriser popup, sélectionner compte

**Résultat attendu:** signInWithPopup réussi, onAuthStateChanged déclenché, session établie, menu utilisateur visible
**Preuves:** logs console, onglet Network (Firebase Auth), présence session dans UI
**Limites:** Peut être bloqué selon navigateur/config

## 2) Popup bloquée, redirection, retour
**Environnement:** Navigateur web - Réalisable immédiatement
**Prérequis:** Popup bloqué (extension/bloqueur) ou mode test

**Étapes:**
1. Bloquer popups pour le domaine
2. Tenter connexion Google
3. Observer redirection vers Google Auth
4. Terminer authentification
5. Revenir sur l'app (Firebase gère redirect)

**Résultat attendu:** Fallback signInWithRedirect déclenché, getRedirectResult appelé, session restaurée après redirection
**Preuves:** Network (redirect), console logs, session restaurée
**Limites:** Comportement dépend du navigateur; doit tester sur domaine réel

## 3) Notification push en arrière-plan + clic
**Environnement:** Navigateur avec SW + Firebase Messaging ou Android - Nécessite appareil/config
**Prérequis:** Notifications autorisées, token FCM enregistré, SW firebase-messaging-sw.js actif

**Étapes:**
1. Se connecter et activer notifications push
2. Envoyer notification test via backend/api/send-push ou console Firebase
3. Mettre onglet/app en arrière-plan
4. Recevoir notification système
5. Cliquer sur notification

**Résultat attendu:** notificationclick dans SW, navigation vers domaine Firebase uniquement
**Preuves:** SW logs, URL finale, client ouvert/focalisé
**Limites:** Nécessite configuration FCM complète, backend fonctionnel

## 4) Vérification URL finale
**Environnement:** Tous - À vérifier sur tous les tests
**Résultat attendu:** Domaine = ugtm-fns-souss-massa.web.app UNIQUEMENT, jamais vercel.app
**Preuves:** URL bar, Network, SW logs

## 5) Maintien de session après clic notification
**Environnement:** Tous - À vérifier
**Résultat attendu:** Auth state conservé, pas de déconnexion, données utilisateur intactes

## 6) Ouverture bon contenu (actualité/événement/signalement)
**Environnement:** Avec données existantes - Partiel
**Prérequis:** Notifications avec targetType/targetId valides
**Résultat attendu:** Navigation vers bon onglet/élément selon paramètres URL
**Preuves:** Écran affiché, logs

## 7) Connexion Android native Capacitor
**Environnement:** Appareil Android avec APK/build - Non réalisable dans cet environnement
**Prérequis:** APK installé, @capacitor-firebase/authentication configuré
**Résultat attendu:** Chemin natif préservé (inchangé), pas de fallback web
**Preuves:** Logs natifs/app
