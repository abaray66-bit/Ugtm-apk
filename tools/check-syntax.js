#!/usr/bin/env node
/* Contrôle de syntaxe du projet UGTM Souss-Massa.
   Vérifie :
   - la syntaxe JavaScript de www/sw.js, www/data.js (classique)
   - la syntaxe de www/cloud.js (module ES)
   - la syntaxe de chaque <script> en ligne de www/app.html
   - la validité JSON de manifest.webmanifest, firebase.json,
     capacitor.config.json et package.json
   Usage : node tools/check-syntax.js   (code retour 0 = OK, 1 = échec) */

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var root = path.join(__dirname, '..');
var failures = 0;

function ok(msg) {
  console.log('OK   ' + msg);
}

function fail(msg, detail) {
  failures += 1;
  console.error('FAIL ' + msg);
  if (detail) console.error(String(detail).trim());
}

function checkJs(label, source, ext) {
  var file = path.join(
    os.tmpdir(),
    'ugtm-check-' + process.pid + '-' + Math.random().toString(36).slice(2) + ext
  );
  fs.writeFileSync(file, source, 'utf8');
  var res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  fs.unlinkSync(file);
  if (res.status === 0) ok(label);
  else fail(label, res.stderr || res.stdout);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/* --- Fichiers JavaScript classiques --- */
['www/sw.js', 'www/data.js'].forEach(function (rel) {
  try {
    checkJs(rel, read(rel), '.js');
  } catch (e) {
    fail(rel, e.message);
  }
});

/* --- Module ES --- */
try {
  checkJs('www/cloud.js (module ES)', read('www/cloud.js'), '.mjs');
} catch (e) {
  fail('www/cloud.js', e.message);
}

/* --- Scripts en ligne des pages HTML --- */
var HTML_FILES = ['www/app.html', 'www/telecharger/index.html'];
HTML_FILES.forEach(function (rel) {
  try {
    var html = read(rel);
    var re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
    var m;
    var n = 0;
    while ((m = re.exec(html)) !== null) {
      n += 1;
      var body = m[1];
      if (!body.trim()) continue;
      checkJs(rel + ' <script #' + n + '>', body, '.js');
    }
    if (n === 0) fail(rel, 'aucun <script> en ligne détecté');
  } catch (e) {
    fail(rel, e.message);
  }
});

/* --- Fichiers JSON --- */
[
  'www/manifest.webmanifest',
  'firebase.json',
  'capacitor.config.json',
  'package.json'
].forEach(function (rel) {
  try {
    JSON.parse(read(rel));
    ok(rel + ' (JSON)');
  } catch (e) {
    fail(rel + ' (JSON)', e.message);
  }
});

/* --- Parité des e-mails administrateur --- */
/* Les adminEmails existent en double : www/data.js (affichage côté client)
   et firestore.rules (droits réels). Si elles divergent, l'app affiche
   l'espace administrateur mais toutes les écritures échouent. */
try {
  function emailsOf(src, re) {
    var m = re.exec(src);
    if (!m) return null;
    var out = [];
    var re2 = /['"]([^'"]+)['"]/g;
    var x;
    while ((x = re2.exec(m[1])) !== null) out.push(String(x[1]).toLowerCase());
    return out.sort();
  }
  var dataEmails = emailsOf(read('www/data.js'), /adminEmails\s*:\s*\[([^\]]*)\]/);
  var rulesEmails = emailsOf(read('firestore.rules'), /function adminEmails\(\)\s*\{\s*return\s*\[([^\]]*)\]/);
  if (!dataEmails || !dataEmails.length) fail('www/data.js (adminEmails)', 'liste introuvable');
  else if (!rulesEmails || !rulesEmails.length) fail('firestore.rules (adminEmails)', 'liste introuvable');
  else if (dataEmails.join('|') !== rulesEmails.join('|')) {
    fail('parité adminEmails',
      'data.js=[' + dataEmails.join(', ') + '] vs firestore.rules=[' + rulesEmails.join(', ') + ']');
  } else ok('adminEmails data.js == firestore.rules (' + dataEmails.length + ')');
} catch (e) {
  fail('parité adminEmails', e.message);
}

/* --- Parité des traductions (www/app.html) ---
   Chaque écran est bilingue FR/AR. Une clé data-i18n ou t.xxx absente
   d'un dictionnaire affiche « undefined » dans l'interface. On vérifie
   que toutes les clés utilisées existent dans les deux dictionnaires. */
try {
  var appHtml = read('www/app.html');

  // Le dictionnaire vit dans un <script> en ligne de app.html.
  var scripts = [];
  var scriptRe = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  var sm;
  while ((sm = scriptRe.exec(appHtml)) !== null) {
    if (sm[1].trim()) scripts.push(sm[1]);
  }
  // Tous les scripts concaténés : les clés sont utilisées dans
  // plusieurs blocs <script> (app principale + parcours d'adhésion).
  var mainScript = scripts.join('\n');

  function dictBody(source, name) {
    var open = source.search(new RegExp('(?:^|\\n)[ \\t]*' + name + '\\s*:\\s*\\{'));
    if (open < 0) return null;
    open = source.indexOf('{', open);
    var depth = 0;
    for (var i = open; i < source.length; i++) {
      var ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return source.slice(open, i + 1);
      }
    }
    return null;
  }

  // Clés de dictionnaire : identifiant collé aux deux points (pas d'espace,
  // pour ne pas ramasser les « mot : » des textes français).
  function keysOf(body) {
    var out = [];
    var re = /(?:^|[{,\n])[ \t]*([A-Za-z_$][\w$]*)[ \t]*:/g;
    var m;
    while ((m = re.exec(body)) !== null) out.push(m[1]);
    return out;
  }

  var frBody = dictBody(mainScript, 'fr');
  var arBody = dictBody(mainScript, 'ar');
  if (!frBody || !arBody) {
    fail('i18n app.html', 'dictionnaires fr/ar introuvables');
  } else {
    var frKeys = keysOf(frBody);
    var arKeys = keysOf(arBody);
    var frSet = {};
    frKeys.forEach(function (k) { frSet[k] = true; });
    var arSet = {};
    arKeys.forEach(function (k) { arSet[k] = true; });

    var used = {};
    function use(k) { if (k) used[k] = true; }
    var im;
    var i18nRe = /data-i18n="([^"]+)"/g;
    while ((im = i18nRe.exec(appHtml)) !== null) use(im[1]);
    var litRe = /setAttribute\('data-i18n',\s*'([^']+)'\)/g;
    while ((im = litRe.exec(mainScript)) !== null) use(im[1]);
    var tRe = /[^A-Za-z0-9_$.](?:t|T\(\))\.([A-Za-z0-9_]+)/g;
    while ((im = tRe.exec(mainScript)) !== null) use(im[1]);

    // Clés posées dynamiquement (setAttribute('data-i18n', key)).
    ['fillAdhesion', 'renewAdhesion'].forEach(use);

    var missFr = Object.keys(used).filter(function (k) { return !frSet[k]; });
    var missAr = Object.keys(used).filter(function (k) { return !arSet[k]; });

    if (missFr.length) fail('i18n fr', 'clés utilisées absentes : ' + missFr.join(', '));
    else if (missAr.length) fail('i18n ar', 'clés utilisées absentes : ' + missAr.join(', '));
    else ok('i18n app.html : ' + Object.keys(used).length + ' clés utilisées présentes en fr et ar');
  }
} catch (e) {
  fail('i18n app.html', e.message);
}

/* --- Parité des traductions (page de téléchargement) ---
   La page officielle de téléchargement est bilingue FR/AR : une clé
   absente d'un dictionnaire afficherait le nom de la clé en clair. */
try {
  var dlHtml = read('www/telecharger/index.html');
  var dlScripts = [];
  var dlRe = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  var dm;
  while ((dm = dlRe.exec(dlHtml)) !== null) {
    if (dm[1].trim()) dlScripts.push(dm[1]);
  }
  var dlScript = dlScripts.join('\n');

  function dlDictBody(name) {
    var open = dlScript.search(new RegExp('(?:^|[\\n,{])[ \\t]*' + name + '\\s*:\\s*\\{'));
    if (open < 0) return null;
    open = dlScript.indexOf('{', open);
    var depth = 0;
    for (var i = open; i < dlScript.length; i++) {
      var ch = dlScript[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return dlScript.slice(open, i + 1);
      }
    }
    return null;
  }

  function dlKeysOf(body) {
    var out = [];
    var re = /(?:^|[{,\n])[ \t]*([A-Za-z_$][\w$]*)[ \t]*:/g;
    var m;
    while ((m = re.exec(body)) !== null) out.push(m[1]);
    return out;
  }

  var dlFr = dlDictBody('fr');
  var dlAr = dlDictBody('ar');
  if (!dlFr || !dlAr) {
    fail('i18n telecharger', 'dictionnaires fr/ar introuvables');
  } else {
    var dlFrSet = {};
    dlKeysOf(dlFr).forEach(function (k) { dlFrSet[k] = true; });
    var dlArSet = {};
    dlKeysOf(dlAr).forEach(function (k) { dlArSet[k] = true; });

    var dlUsed = {};
    function dlUse(k) { if (k) dlUsed[k] = true; }
    var dim;
    var dlI18nRe = /data-i18n="([^"]+)"/g;
    while ((dim = dlI18nRe.exec(dlHtml)) !== null) dlUse(dim[1]);
    var dlCallRe = /\bt\(\s*["']([A-Za-z0-9_]+)["']\s*\)/g;
    while ((dim = dlCallRe.exec(dlScript)) !== null) dlUse(dim[1]);

    var dlMissFr = Object.keys(dlUsed).filter(function (k) { return !dlFrSet[k]; });
    var dlMissAr = Object.keys(dlUsed).filter(function (k) { return !dlArSet[k]; });

    if (dlMissFr.length) fail('i18n telecharger fr', 'clés utilisées absentes : ' + dlMissFr.join(', '));
    else if (dlMissAr.length) fail('i18n telecharger ar', 'clés utilisées absentes : ' + dlMissAr.join(', '));
    else ok('i18n telecharger/index.html : ' + Object.keys(dlUsed).length + ' clés utilisées présentes en fr et ar');
  }
} catch (e) {
  fail('i18n telecharger', e.message);
}

if (failures) {
  console.error('\n' + failures + ' controle(s) en echec.');
  process.exit(1);
}
console.log('\nTous les contrôles sont passés.');
