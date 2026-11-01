#!/usr/bin/env node
/* Tests ciblés de l'audit UGTM Souss-Massa.
   Chaque fonction testée est EXTRAITE du source réel (www/app.html,
   www/cloud.js) puis évaluée avec des dépendances de test : on vérifie
   le code livré, pas une version recopiée.

   Couverture : lien WhatsApp valide, séparation Nom/Prénom, cellule CSV
   (injection de formules), récapitulatif de signalement, accès au groupe
   WhatsApp, événements de l'accueil, statuts d'adhésion + note de
   complément, redimensionnement des pièces jointes, référence/ mise en
   page du PDF (génération réelle + contrôle de chevauchement).

   Usage : node tools/test-audit-ugtm.mjs  (code retour 0 = OK) */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'www', 'app.html'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'www', 'cloud.js'), 'utf8');

let failures = 0;
function ok(name) { console.log('OK   ' + name); }
function ko(name, detail) {
  failures += 1;
  console.error('FAIL ' + name + (detail ? '\n     ' + detail : ''));
}
function assert(cond, name, detail) { cond ? ok(name) : ko(name, detail); }

/* ------------------------------------------------------------------ */
/* Extraction d'une fonction réelle du source (accolades équilibrées,   */
/* chaînes et commentaires ignorés).                                    */
/* ------------------------------------------------------------------ */
function extractFrom(src, name, label) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('fonction introuvable : ' + name + (label ? ' (' + label + ')' : ''));
  const start = m.index;
  let depth = 0;
  let mode = null;          // null | ' | " | ` | // | /* | re
  let lastSig = '';         // dernier caractère significatif (détection regex)
  const regexPrecedes = /[({\[=,;:!&|?]|\b(return|case|do|else|in|of|new|typeof|void|delete|instanceof)$/;

  const skipRegex = (j) => {
    /* j pointe sur le '/' ouvrant : on saute jusqu'au '/' fermant,
       en gérant les classes de caractères [...]. */
    let inClass = false;
    for (j += 1; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j += 1;
        while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
        return j - 1;
      }
      else if (c === '\n') return j; // regex non fermée : on se ravise
    }
    return src.length - 1;
  };

  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    const next = src[j + 1];
    if (mode === "'" || mode === '"' || mode === '`') {
      if (ch === '\\') { j++; continue; }
      if (ch === mode) mode = null;
      if (!/\s/.test(ch)) lastSig = ch;
      continue;
    }
    if (mode === '//') { if (ch === '\n') { mode = null; lastSig = '\n'; } continue; }
    if (mode === '/*') { if (ch === '*' && next === '/') { mode = null; j++; lastSig = '/'; } continue; }
    if (ch === "'" || ch === '"' || ch === '`') { mode = ch; lastSig = ch; continue; }
    if (ch === '/' && next === '/') { mode = '//'; j++; continue; }
    if (ch === '/' && next === '*') { mode = '/*'; j++; continue; }
    if (ch === '/' && regexPrecedes.test(lastSig)) { j = skipRegex(j); lastSig = '/'; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
    if (!/\s/.test(ch)) lastSig = (lastSig + ch).slice(-12);
  }
  throw new Error('extraction incomplète : ' + name);
}

function compile(name, deps, src = html, label = '') {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('fonction introuvable : ' + name + (label ? ' (' + label + ')' : ''));
  const before = src.slice(Math.max(0, m.index - 8), m.index);
  const isAsync = /async\s+$/.test(before);
  const code = extractFrom(src, name, label);
  const keys = Object.keys(deps);
  const body = '\nreturn ' + (isAsync ? '(async ' + code + ')' : code) + ';';
  const fn = new Function(...keys, body);
  return fn(...keys.map((k) => deps[k]));
}

/* Dictionnaires i18n réels (FR / AR) pour vérifier les traductions. */
function loadI18n() {
  const marker = /var\s+I18N\s*=\s*\{/.exec(html);
  if (!marker) throw new Error('I18N introuvable');
  const open = html.indexOf('{', marker.index);
  let depth = 0, mode = null, end = -1;
  for (let j = open; j < html.length; j++) {
    const ch = html[j], next = html[j + 1];
    if (mode === "'" || mode === '"' || mode === '`') {
      if (ch === '\\') { j++; continue; }
      if (ch === mode) mode = null;
      continue;
    }
    if (mode === '/*') { if (ch === '*' && next === '/') { mode = null; j++; } continue; }
    if (ch === "'" || ch === '"' || ch === '`') { mode = ch; continue; }
    if (ch === '/' && next === '*') { mode = '/*'; j++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = j + 1; break; }
    }
  }
  if (end < 0) throw new Error('I18N non terminé');
  const literal = html.slice(open, end);
  if (literal.includes('${')) throw new Error('I18N : interpolation inattendue');
  // eslint-disable-next-line no-new-func
  return new Function('return (' + literal + ');')();
}

const I18N = loadI18n();
const T = (l = 'fr') => I18N[l];

/* Élément factice pour les tests DOM. */
function fakeElement(id) {
  return {
    id, hidden: false, textContent: '', innerHTML: '', className: '',
    value: '', checked: false, disabled: false,
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild() {}, addEventListener() {}, focus() {},
    closest() { return null; },
    querySelector() { return null; }
  };
}
function fakeDom(ids = []) {
  const map = {};
  ids.forEach((id) => { map[id] = fakeElement(id); });
  return function $(id) {
    if (!map[id]) map[id] = fakeElement(id);
    return map[id];
  };
}

/* ================================================================== */
/* 1. Lien WhatsApp valide (numéro régional, provincial, responsables) */
/* ================================================================== */
try {
  const waHref = compile('waHref', {});
  assert(waHref('06 61 38 62 47') === 'https://wa.me/212661386247',
    'waHref : numéro local marocain → international');
  assert(waHref('0661386247') === 'https://wa.me/212661386247',
    'waHref : numéro local sans espaces');
  assert(waHref('+212661386247') === 'https://wa.me/212661386247',
    'waHref : numéro international conservé');
  assert(waHref('661386247') === 'https://wa.me/212661386247',
    'waHref : numéro national à 9 chiffres');
  assert(waHref('') === '', 'waHref : numéro absent → aucun lien');
  assert(waHref('abc') === '', 'waHref : numéro inexploitable → aucun lien');
  assert(waHref('0661386') === '', 'waHref : numéro trop court → aucun lien');
  assert(waHref('0000000000000000000') === '', 'waHref : nombre de chiffres hors bornes');
} catch (e) { ko('waHref (extraction)', e.message); }

/* ================================================================== */
/* 2. Séparation Nom / Prénom (aucun découpage inventé)                */
/* ================================================================== */
try {
  const splitFullName = compile('splitFullName', {});
  assert(JSON.stringify(splitFullName('Abdelaziz Abaray'))
    === JSON.stringify({ nom: 'Abaray', prenom: 'Abdelaziz' }),
    'splitFullName : deux mots → Nom = dernier, Prénom = premier');
  assert(JSON.stringify(splitFullName('ABARAY, Abdelaziz'))
    === JSON.stringify({ nom: 'ABARAY', prenom: 'Abdelaziz' }),
    'splitFullName : marqueur « NOM, Prénom » explicite');
  assert(JSON.stringify(splitFullName('Mohamed Ben Ali'))
    === JSON.stringify({ nom: 'Mohamed Ben Ali', prenom: '' }),
    'splitFullName : trois mots (nom composé) → aucun découpage');
  assert(JSON.stringify(splitFullName('Cherkaoui'))
    === JSON.stringify({ nom: 'Cherkaoui', prenom: '' }),
    'splitFullName : un seul mot → Nom seul');
  assert(JSON.stringify(splitFullName('  Fatima   Zahra  '))
    === JSON.stringify({ nom: 'Zahra', prenom: 'Fatima' }),
    'splitFullName : espaces superflus normalisés');
  assert(JSON.stringify(splitFullName('')) === JSON.stringify({ nom: '', prenom: '' }),
    'splitFullName : nom vide → rien');
} catch (e) { ko('splitFullName (extraction)', e.message); }

/* ================================================================== */
/* 3. Cellule CSV : accents, guillemets, injection de formules         */
/* ================================================================== */
try {
  const csvCell = compile('csvCell', {});
  assert(csvCell('=1+1') === '"\'=1+1"', 'csvCell : « = » neutralisé');
  assert(csvCell('@SUM(A1)') === '"\'@SUM(A1)"', 'csvCell : « @ » neutralisé');
  assert(csvCell('+CALCUL()') === '"\'+CALCUL()"', 'csvCell : « + » non numérique neutralisé');
  assert(csvCell('-ATTACK()') === '"\'-ATTACK()"', 'csvCell : « - » non numérique neutralisé');
  assert(csvCell('\t=1+1').startsWith('"\''), 'csvCell : tabulation initiale neutralisée');
  assert(csvCell('+212 661 38 62 47') === '"+212 661 38 62 47"',
    'csvCell : téléphone « + » numérique intact');
  assert(csvCell('-5') === '"-5"', 'csvCell : nombre négatif intact');
  assert(csvCell('Établissement "Public"') === '"Établissement ""Public"""',
    'csvCell : accents préservés et guillemets doublés');
  assert(csvCell('قاعة') === '"قاعة"', 'csvCell : caractères arabes préservés');
  assert(csvCell('') === '""', 'csvCell : valeur vide');
  assert(csvCell(null) === '""', 'csvCell : null → cellule vide');
  assert(csvCell('SM-0001\r\nX') === '"SM-0001\r\nX"',
    'csvCell : retour à la ligne conservé À L\'INTÉRIEUR des guillemets (ligne unique pour le tableur)');
} catch (e) { ko('csvCell (extraction)', e.message); }

/* ================================================================== */
/* 4. Récapitulatif de signalement (WhatsApp)                          */
/* ================================================================== */
try {
  const buildReportShareText = compile('buildReportShareText', {
    T: () => T('fr'),
    reportCategoryLabelI18n: (c) => (c === 'housing' ? 'Logement' : c),
    reportStatusLabelI18n: (s) => (s === 'new' ? 'Nouveau' : s),
    provName: (v) => (v === 'agadir' ? 'Agadir Ida-Outanane' : (v || '')),
    lang: 'fr'
  });
  const rep = {
    id: 'REP12345',
    category: 'housing',
    etab: 'CHU Ibn Tofail',
    province: 'agadir',
    date: '2026-10-21',
    status: 'new',
    description: 'Fuite d’eau dans le service de consultation.',
    attachmentName: 'photo.jpg'
  };
  const text = buildReportShareText(rep);
  assert(text.includes('REP12345'), 'récapitulatif : référence du signalement présente');
  assert(text.includes('Logement'), 'récapitulatif : motif affiché avec le libellé corrigé');
  assert(text.includes('CHU Ibn Tofail'), 'récapitulatif : établissement présent');
  assert(text.includes('Agadir Ida-Outanane'), 'récapitulatif : province présente');
  assert(text.includes('2026-10-21'), 'récapitulatif : date présente');
  assert(text.includes('Fuite d’eau'), 'récapitulatif : résumé présent');
  assert(text.includes('photo.jpg') && /manuel/i.test(text),
    'récapitulatif : pièce jointe annoncée comme à joindre à la main');
  assert(text.split('\n').length >= 7, 'récapitulatif : lignes séparées (encodable pour WhatsApp)');
  assert(!/CIN|PPR/i.test(text), 'récapitulatif : aucune donnée sensible (CIN/PPR)');
  assert(buildReportShareText(null) === '', 'récapitulatif : signalement absent → chaîne vide');
} catch (e) { ko('buildReportShareText (extraction)', e.message); }

/* ================================================================== */
/* 5. Accès au groupe WhatsApp régional                                */
/* ================================================================== */
try {
  const cases = [
    [{ user: null, cloud: 'ready', member: null, isAdmin: false }, false, 'visiteur non connecté'],
    [{ user: { uid: 'u1' }, cloud: 'ready', member: { status: 'pending' }, isAdmin: false }, false, 'adhésion en attente'],
    [{ user: { uid: 'u1' }, cloud: 'ready', member: { status: 'blocked' }, isAdmin: false }, false, 'compte suspendu'],
    [{ user: { uid: 'u1' }, cloud: 'ready', member: { status: 'active' }, isAdmin: false }, true, 'adhésion validée'],
    [{ user: { uid: 'u1' }, cloud: 'ready', member: { status: 'pending' }, isAdmin: true }, true, 'administrateur'],
    [{ user: { uid: 'u1' }, cloud: 'loading', member: null, isAdmin: false }, null, 'statut encore inconnu']
  ];
  for (const [S, expected, label] of cases) {
    const fn = compile('whatsappGroupAllowed', { S });
    assert(fn() === expected, 'groupe WhatsApp : ' + label);
  }
} catch (e) { ko('whatsappGroupAllowed (extraction)', e.message); }

/* ================================================================== */
/* 6. Événements de la page d'accueil                                  */
/* ================================================================== */
try {
  const pad = compile('pad', {});
  const todayStr = compile('todayStr', { pad });
  const mkEvents = () => ([
    { id: 'past1', date: '2026-10-20', time: '19:52', fr: { t: 'Bureau à Safi' } },
    { id: 'past2', date: '2026-09-01', time: '', fr: { t: 'Ancien' } },
    { id: 'next1', date: '2026-11-05', time: '10:00', fr: { t: 'Réunion' } },
    { id: 'next2', date: '2026-12-12', time: '', fr: { t: 'Assemblée' } }
  ]);
  const empty = compile('homeEvents', { EVENTS: [], upcoming: compile('upcoming', { EVENTS: [], todayStr }) });
  assert(empty().list.length === 0 && !empty().fallback,
    'accueil : aucun événement → état vide (sans faux repli)');

  const onlyPast = compile('homeEvents', {
    EVENTS: [mkEvents()[0]],
    upcoming: compile('upcoming', { EVENTS: [mkEvents()[0]], todayStr })
  });
  const rPast = onlyPast();
  assert(rPast.list.length === 1 && rPast.fallback === true && rPast.list[0].id === 'past1',
    'accueil : dernier événement publié affiché quand rien n\'est à venir (cause du bug)');

  const mixed = compile('homeEvents', {
    EVENTS: mkEvents(),
    upcoming: compile('upcoming', { EVENTS: mkEvents(), todayStr })
  });
  const rMixed = mixed();
  assert(rMixed.fallback === false && rMixed.list.length === 2
    && rMixed.list[0].id === 'next1' && rMixed.list[1].id === 'next2',
    'accueil : rendez-vous à venir en priorité, triés, passé exclu');
} catch (e) { ko('homeEvents (extraction)', e.message); }

/* ================================================================== */
/* 7. Statuts d'adhésion : un message cohérent + année de validité     */
/* ================================================================== */
try {
  const $ = fakeDom(['meStatus', 'meAdhesionStatus', 'meAdhesionButton']);
  const adhesionYear = compile('adhesionYear', { myAdhesionStatusCache: null });
  const adhesionValidatedMessage = compile('adhesionValidatedMessage', {
    adhesionYear, T: () => T('fr')
  });
  const renderStatus = (S, cache) => {
    /* Chaque appel compile adhesionValidatedMessage AVEC le cache de la       demande : c'est la chaîne réelle utilisée par l'application. */
    const yearFn = compile('adhesionYear', { myAdhesionStatusCache: cache });
    const validFn = compile('adhesionValidatedMessage', { adhesionYear: yearFn, T: () => T('fr') });
    const fn = compile('renderMyMemberStatus', {
      $, T: () => T('fr'), S, myAdhesionStatusCache: cache,
      adhesionYear: yearFn, adhesionValidatedMessage: validFn
    });
    const box = $('meStatus');
    box.hidden = false; box.textContent = '';
    fn();
    return box;
  };

  let box = renderStatus({ member: { status: 'blocked' } }, null);
  assert(!box.hidden && box.textContent === T('fr').st_blocked,
    'statut : compte suspendu affiché');

  box = renderStatus({ member: { status: 'pending' } }, null);
  assert(box.hidden === true,
    'statut : membre sans demande → aucun message « en cours de validation » mensonger');

  box = renderStatus({ member: { status: 'pending' } }, { status: 'pending' });
  assert(box.hidden === true,
    'statut : demande en attente → la ligne de demande porte seule le message (pas de doublon)');

  box = renderStatus({ member: { status: 'pending' } }, { status: 'refused' });
  assert(box.hidden === true,
    'statut : demande refusée → pas de message contradictoire sur le compte');

  box = renderStatus({ member: { status: 'pending' } }, { status: 'accepted' });
  assert(!box.hidden && box.textContent === T('fr').st_pendingSigned,
    'statut : dossier signé, compte non activé → message distinct « activation en cours »');

  box = renderStatus({ member: { status: 'active', activatedAt: Date.UTC(2026, 0, 15) } }, null);
  assert(!box.hidden && box.textContent === 'Adhésion validée pour l\'année 2026.',
    'statut : année de validité prise dans activatedAt (2026)');

  box = renderStatus({ member: { status: 'active', activatedAt: Date.UTC(2024, 5, 1) } },
    { status: 'accepted', signedAt: Date.UTC(2025, 10, 2) });
  assert(!box.hidden && box.textContent === 'Adhésion validée pour l\'année 2025.',
    'statut : renouvellement → année de la signature (2025) prioritaire');

  box = renderStatus({ member: { status: 'active', activatedAt: 0 } }, null);
  assert(!box.hidden && box.textContent === 'Adhésion validée.',
    'statut : sans date enregistrée → aucun millésime inventé');

  /* Traductions de la nouvelle ligne de compte. */
  assert(!!T('ar').stActiveYear && !!T('ar').st_pendingSigned,
    'statut : traductions arabes présentes (stActiveYear, st_pendingSigned)');
  assert(String(T('fr').stActiveYear).includes('%1') && String(T('ar').stActiveYear).includes('%1'),
    'statut : année injectée par jeton, jamais en dur');
} catch (e) { ko('statuts d\'adhésion (extraction)', e.message); }

/* ================================================================== */
/* 8. Note de complément de l'administration                           */
/* ================================================================== */
try {
  const $ = fakeDom(['meAdhesionStatus', 'meAdhesionButton', 'meStatus']);
  const adhesionYear = compile('adhesionYear', { myAdhesionStatusCache: null });
  const adhesionValidatedMessage = compile('adhesionValidatedMessage', { adhesionYear, T: () => T('fr') });
  const renderMyMemberStatus = compile('renderMyMemberStatus', {
    $, T: () => T('fr'), S: { member: { status: 'pending' } },
    myAdhesionStatusCache: null, adhesionYear, adhesionValidatedMessage
  });
  const win = {};
  const doc = { createElement: () => fakeElement('span') };
  const show = (request, member) => {
    const fn = compile('showMyAdhesionStatus', {
      $, T: () => T('fr'), renderMyMemberStatus, window: win,
      S: { member: member || { status: 'pending' } }, document: doc
    });
    const box = $('meAdhesionStatus');
    box.hidden = false; box.textContent = '';
    fn(request);
    return box;
  };

  let box = show({ status: 'needs_completion', adminNote: 'Précisez votre service et votre établissement.' });
  assert(box.textContent.includes('un complément est demandé'),
    'complément : message d\'état affiché');
  assert(box.textContent.includes('Précisez votre service et votre établissement.'),
    'complément : NOTE exacte de l\'administration affichée');

  box = show({ status: 'needs_completion', adminNote: '' });
  assert(box.textContent.includes(T('fr').adhStatusNoNote),
    'complément : note absente → message explicite (jamais de vide)');

  box = show({ status: 'pending' });
  assert(box.textContent === T('fr').adhStatusPending && !box.textContent.includes('Précisez'),
    'complément : demande en attente → message d\'attente seul');

  box = show({ status: 'accepted', adminNote: 'Bienvenue.' }, { status: 'active' });
  assert(box.textContent === 'Bienvenue.',
    'adhérent actif + dossier accepté → seule la note reste (pas de doublon)');

  box = show({ status: 'accepted', adminNote: 'x' }, { status: 'pending' });
  assert(box.hidden === true,
    'dossier signé, compte inactif → la ligne de compte porte le message (pas de doublon)');

  assert(!!T('ar').adhStatusNoNote, 'complément : traduction arabe présente');
} catch (e) { ko('note de complément (extraction)', e.message); }

/* ================================================================== */
/* 9. Redimensionnement des pièces jointes du signalement              */
/* ================================================================== */
try {
  const JPEG1x1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  let dataUrlCalls = 0;
  const ImageStub = function () {
    this.naturalWidth = 4000;
    this.naturalHeight = 3000;
    Object.defineProperty(this, 'src', {
      set() { setTimeout(() => { if (this.onload) this.onload(); }, 0); },
      get() { return 'blob:test'; }
    });
  };
  const FileReaderStub = function () {};
  FileReaderStub.prototype.readAsDataURL = function (file) {
    const self = this;
    setTimeout(() => { self.result = file.__dataUrl; if (self.onload) self.onload(); }, 0);
  };
  const documentStub = {
    createElement(tag) {
      if (tag !== 'canvas') return fakeElement(tag);
      return {
        width: 0, height: 0,
        getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; },
        toDataURL() {
          dataUrlCalls += 1;
          /* Trop lourd au premier passage, dans la limite ensuite. */
          return dataUrlCalls === 1 ? 'data:image/jpeg;base64,' + 'A'.repeat(500000)
            : 'data:image/jpeg;base64,' + 'A'.repeat(300000);
        }
      };
    }
  };
  const MAXC = 300 * 1024 * 4 / 3;

  const prepare = () => compile('prepareReportAttachment', {
    T: () => T('fr'), FileReader: FileReaderStub, Image: ImageStub,
    document: documentStub, REPORT_ATTACH_MAX_CHARS: MAXC
  });

  const bigImage = { name: 'photo.png', type: 'image/png', size: 4000000, __dataUrl: 'data:image/png;base64,AAAA' };
  const resImg = await prepare()(bigImage);
  assert(resImg && resImg.type === 'image/jpeg',
    'pièce jointe : image redimensionnée/recompressée (type final JPEG)');
  assert(resImg && resImg.data.length <= MAXC,
    'pièce jointe : résultat réellement sous la limite de 300 Ko');
  assert(resImg && /\.jpg$/.test(resImg.name),
    'pièce jointe : nom de fichier cohérent avec le contenu produit');

  const smallPdf = { name: 'fiche.pdf', type: 'application/pdf', size: 40000, __dataUrl: 'data:application/pdf;base64,AAAA' };
  const resPdf = await prepare()(smallPdf);
  assert(resPdf && resPdf.type === 'application/pdf' && resPdf.name === 'fiche.pdf',
    'pièce jointe : PDF sous la limite accepté tel quel');

  const bigPdf = { name: 'gros.pdf', type: 'application/pdf', size: 400000, __dataUrl: 'data:application/pdf;base64,' + 'A'.repeat(400000) };
  let err = null;
  try { await prepare()(bigPdf); } catch (e) { err = e; }
  assert(err && err.message === T('fr').attachTooBig,
    'pièce jointe : PDF au-delà de 300 Ko → refus explicite');

  const weird = { name: 'doc.docx', type: 'application/msword', size: 1000, __dataUrl: 'data:application/msword;base64,AAAA' };
  err = null;
  try { await prepare()(weird); } catch (e) { err = e; }
  assert(err && err.message === T('fr').attachTooBig,
    'pièce jointe : format non pris en charge → refus explicite');
} catch (e) { ko('pièces jointes (extraction)', e.message); }

/* ================================================================== */
/* 10. PDF d'adhésion : génération réelle + chevauchement + référence  */
/* ================================================================== */
const outDir = path.join(root, 'pdf-tests');
try {
  const jspdfLib = require(path.join(root, 'www', 'jspdf.umd.min.js'));
  const Base = jspdfLib.jsPDF || jspdfLib.default?.jsPDF;
  if (!Base) throw new Error('jsPDF introuvable dans www/jspdf.umd.min.js');

  const JPEG1x1 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

  let calls = [];
  let images = [];
  /* jsPDF attache ses méthodes d'une façon qui échappe à un surclassement :   on enveloppe l'INSTANCE produite (le constructeur retourne l'objet   enveloppé, ce que `new` accepte) pour enregistrer texte et images. */
  function RecordingJsPDF(...args) {
    const inst = new Base(...args);
    /* Les pieds de page se répètent à l'identique sur chaque page :
       chaque appel est donc rattaché au numéro de page courant. */
    let page = 1;
    const origAddPage = inst.addPage.bind(inst);
    inst.addPage = function (...a) { page += 1; return origAddPage(...a); };
    /* Le pied de page est imprimé via setPage(p) sur chaque page. */
    const origSetPage = inst.setPage.bind(inst);
    inst.setPage = function (p) {
      if (typeof p === 'number') page = p;
      else if (p && typeof p === 'object' && p.pageNumber) page = p.pageNumber;
      return origSetPage(p);
    };
    const origText = inst.text.bind(inst);
    inst.text = function (str, x, y, opts) {
      const w = inst.getTextWidth(String(str));
      const internal = inst.internal;
      const size = typeof internal.getFontSize === 'function' ? internal.getFontSize() : 0;
      calls.push({ page, text: String(str), x, y, opts: opts || null, w, size });
      return origText(str, x, y, opts);
    };
    const origAdd = inst.addImage.bind(inst);
    inst.addImage = function (...a) { images.push(a); return origAdd(...a); };
    return inst;
  }

  const ImageStub = function () {
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    Object.defineProperty(this, 'src', {
      set() { setTimeout(() => { if (this.onload) this.onload(); }, 0); },
      get() { return 'icons/ugtm-logo.svg'; }
    });
  };
  const documentStub = {
    createElement(tag) {
      if (tag !== 'canvas') return fakeElement(tag);
      return {
        width: 0, height: 0,
        getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; },
        toDataURL() { return 'data:image/jpeg;base64,' + JPEG1x1; }
      };
    }
  };

  const adhesionPdfBase64 = compile('adhesionPdfBase64', {
    window: { jspdf: { jsPDF: RecordingJsPDF } },
    document: documentStub,
    Image: ImageStub,
    provName: (v) => (v === 'agadir' ? 'Agadir Ida-Outanane' : (v || ''))
  });

  const scenarios = [
    {
      file: 'test-court.pdf',
      label: 'valeurs courtes',
      request: {
        id: 'testcourt123',
        adminSignature: 'data:image/jpeg;base64,' + JPEG1x1,
        signature: 'data:image/jpeg;base64,' + JPEG1x1,
        signerName: 'Abdelaziz Abaray (abaray66@gmail.com)',
        signedAt: Date.UTC(2026, 9, 21),
        application: {
          nom: 'Abaray', prenom: 'Abdelaziz', cin: 'BK123456', dob: '1980-04-12',
          phone: '0661386247', province: 'agadir', address: 'Agadir, Hay Mohammadi 12',
          establishment: 'CHU Ibn Tofail', service: 'Urgences', 'function': 'Médecin',
          specialty: 'Médecine d\'urgence', ppr: '123456', type: 'first', date: '2026-10-21'
        }
      }
    },
    {
      file: 'test-long.pdf',
      label: 'valeurs longues (noms, établissement, adresse)',
      request: {
        id: 'testlong4567890123',
        adminSignature: 'data:image/jpeg;base64,' + JPEG1x1,
        signature: 'data:image/jpeg;base64,' + JPEG1x1,
        signerName: 'Abdelaziz Abaray (abaray66@gmail.com)',
        signedAt: Date.UTC(2026, 9, 21),
        application: {
          nom: 'El Ouazzani Cherkaoui', prenom: 'Mohamed Abdallah',
          cin: 'BE987654', dob: '1975-11-30',
          phone: '+212 661 38 62 47', province: 'taroudant',
          address: 'Route de Tiznit, Quartier Al Massira, Immobilier N° 45, Étage 3, Appartement 12, Taroudant 83000, Royaume du Maroc',
          establishment: 'Centre Hospitalier Provincial Sheikh Sultan Ben Abderrahmane, Service de Médecine Interne et des Maladies Chroniques',
          service: 'Médecine interne — unité de soins continus et de surveillance',
          'function': 'Médecin chef de service référent pour la coordination des soins',
          specialty: 'Médecine interne, pathologies chroniques et santé publique',
          ppr: '987654321', type: 'renewal',
          reason: 'Renouvellement de mon adhésion en cours d\'exercice : ma situation professionnelle et mon établissement d\'affectation n\'ont pas changé, et je souhaite maintenir mes droits ainsi que mon affiliation continue à la Fédération nationale de la Santé.',
          date: '2026-10-21'
        }
      }
    },
    {
      file: 'test-débordement.pdf',
      label: 'volume très long (passage de page attendu)',
      request: {
        id: 'testoverflow999',
        adminSignature: 'data:image/jpeg;base64,' + JPEG1x1,
        signature: 'data:image/jpeg;base64,' + JPEG1x1,
        signerName: 'Responsable',
        signedAt: Date.UTC(2026, 9, 21),
        application: {
          nom: 'A'.repeat(60), prenom: 'B'.repeat(60), cin: 'X123456', dob: '1970-01-01',
          phone: '0661386247', province: 'agadir',
          address: ('Adresse très longue pour forcer le retour à la ligne du générateur. ').repeat(10),
          establishment: ('Établissement extrêmement détaillé avec plusieurs antennes, pôles et unités de soins. ').repeat(10),
          service: 'Service', 'function': 'Fonction', specialty: 'Spécialité', ppr: '1',
          type: 'renewal', reason: 'Motif de renouvellement. ', date: '2026-10-21'
        }
      }
    }
  ];

  fs.mkdirSync(outDir, { recursive: true });

  for (const sc of scenarios) {
    calls = []; images = [];
    const b64 = await adhesionPdfBase64(sc.request);
    const buf = Buffer.from(String(b64 || ''), 'base64');
    assert(buf.length > 1000 && buf.slice(0, 5).toString() === '%PDF-',
      'PDF (' + sc.label + ') : fichier réellement généré');
    fs.writeFileSync(path.join(outDir, sc.file), buf);

    /* Aucun texte hors des marges de la page (210 x 297 mm). */
    const oob = calls.filter((c) => {
      const align = c.opts && c.opts.align;
      const left = align === 'center' ? c.x - c.w / 2 : (align === 'right' ? c.x - c.w : c.x);
      const right = left + c.w;
      return left < 4 || right > 206 || c.y < 4 || c.y > 293;
    });
    assert(oob.length === 0,
      'PDF (' + sc.label + ') : tout le texte reste dans la page'
      + (oob.length ? ' → ' + JSON.stringify(oob[0]) : ''));

    /* Aucun chevauchement sur une même ligne de base (même page). */
    const rows = {};
    calls.forEach((c) => {
      const k = 'p' + c.page + ' y=' + c.y.toFixed(2);
      (rows[k] = rows[k] || []).push(c);
    });
    let overlap = null;
    Object.keys(rows).forEach((k) => {
      const sorted = rows[k].map((c) => {
        const align = c.opts && c.opts.align;
        const left = align === 'center' ? c.x - c.w / 2 : (align === 'right' ? c.x - c.w : c.x);
        return { left, right: left + c.w, text: c.text };
      }).sort((a, b) => a.left - b.left);
      for (let i = 1; i < sorted.length && !overlap; i++) {
        if (sorted[i].left < sorted[i - 1].right - 0.15) {
          overlap = 'y=' + k + ' « ' + sorted[i - 1].text.slice(0, 40) + ' » / « '
            + sorted[i].text.slice(0, 40) + ' »';
        }
      }
    });
    assert(!overlap, 'PDF (' + sc.label + ') : aucun chevauchement libellé/valeur'
      + (overlap ? ' → ' + overlap : ''));

    /* Référence unique présente et visible. */
    const refCalls = calls.filter((c) => c.text === 'Référence : ' + sc.request.id);
    assert(refCalls.length === 1,
      'PDF (' + sc.label + ') : référence du document en tête de page');
    assert(calls.some((c) => c.text === sc.request.id),
      'PDF (' + sc.label + ') : référence reprise dans la section VALIDATION');
    assert(calls.some((c) => c.text.indexOf('VALIDATION') >= 0),
      'PDF (' + sc.label + ') : section VALIDATION imprimée');
  }

  /* Logo carré : rapport largeur/hauteur conservé. */
  calls = []; images = [];
  await adhesionPdfBase64(scenarios[0].request);
  const logo = images[0];
  assert(logo && Math.abs(logo[4] - logo[5]) < 0.01,
    'PDF : logo dessiné à son rapport d\'origine (aucune compression verticale)'
    + (logo ? ' (w=' + logo[4] + ', h=' + logo[5] + ')' : ' (aucune image)'));

  /* Référence : identifiant Firestore porté par le document relu. */
  try {
    const getAdhesionDoc = compile('getAdhesionDoc', {
      doc: (a, b) => ({ __path: a + '/' + b }),
      db: {},
      getDoc: async () => ({ id: 'uidABC', exists: () => true, data: () => ({ province: 'agadir', status: 'accepted' }) })
    }, cloud, 'cloud.js');
    const doc = await getAdhesionDoc('uidABC');
    assert(doc && doc.id === 'uidABC',
      'référence du dossier : getAdhesionDoc expose l\'identifiant du document');
  } catch (e) { ko('getAdhesionDoc (extraction)', e.message); }
} catch (e) {
  ko('PDF d\'adhésion (extraction/génération)', e.message);
}

/* ================================================================== */
/* Bilan                                                               */
/* ================================================================== */
console.log('');
if (failures) {
  console.error(failures + ' test(s) en échec.');
  process.exit(1);
}
console.log('Tous les tests d\'audit sont passés.'
  + ' PDF de test générés dans pdf-tests/ (' + fs.readdirSync(outDir).join(', ') + ').');
