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

/* --- Scripts en ligne de app.html --- */
try {
  var html = read('www/app.html');
  var re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  var m;
  var n = 0;
  while ((m = re.exec(html)) !== null) {
    n += 1;
    var body = m[1];
    if (!body.trim()) continue;
    checkJs('www/app.html <script #' + n + '>', body, '.js');
  }
  if (n === 0) fail('www/app.html', 'aucun <script> en ligne détecté');
} catch (e) {
  fail('www/app.html', e.message);
}

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

if (failures) {
  console.error('\n' + failures + ' controle(s) en echec.');
  process.exit(1);
}
console.log('\nTous les contrôles sont passés.');
