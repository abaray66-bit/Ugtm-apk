#!/usr/bin/env node
/* Audit statique local : aucune lecture de secret ni accès réseau. */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function fail(message) { failures.push(message); console.error(`FAIL ${message}`); }
function ok(message) { console.log(`OK   ${message}`); }

for (const file of ['package.json','package-lock.json','firestore.rules','firebase.json','capacitor.config.json','www/cloud.js','.github/workflows/apk.yml']) {
  if (exists(file)) ok(`${file} présent`); else fail(`${file} absent`);
}

try {
  const pkg = JSON.parse(read('package.json'));
  JSON.parse(read('package-lock.json'));
  if (pkg.scripts?.check) ok('script de vérification présent'); else fail('package.json: script check absent');
  if (pkg.scripts?.['audit:security']) ok('script audit:security présent'); else fail('package.json: script audit:security absent');
} catch (error) { fail(`JSON package/package-lock invalide: ${error.message}`); }

try {
  const rules = read('firestore.rules');
  if (/rules_version\s*=\s*["']2["']\s*;/.test(rules)) ok('Firestore Rules version 2'); else fail('firestore.rules: rules_version 2 absente');
  if (/allow\s+(?:read|write|create|update|delete|read\s*,\s*write)\s*:\s*if\s+true\s*;/.test(rules)) fail('firestore.rules: autorisation inconditionnelle détectée'); else ok('Firestore: aucune autorisation inconditionnelle détectée');
  const members = rules.match(/match\s+\/members\/\{uid\}[\s\S]*?\n\s*\}\s*\n\s*\/\/\s*=+\s*\n\s*COMPTEURS/);
  if (!members) fail('firestore.rules: bloc members introuvable pour audit des rôles');
  else {
    const active = members[0].match(/allow\s+create:[\s\S]*?request\.resource\.data\.status\s*==\s*['"]active['"][\s\S]*?;\n\s*\n\s*allow\s+update:/);
    if (!active) fail('firestore.rules: branche de création active introuvable');
    else if (/isSubAdmin\(\)[\s\S]*?request\.resource\.data\.status\s*==\s*['"]active['"]/.test(active[0]) && !/request\.resource\.data\.role\s*==\s*['"]member['"]/.test(active[0])) fail('firestore.rules: création active sous-admin sans rôle member explicite');
    else ok('Firestore: création active et rôle sous-admin bornés');
  }
} catch (error) { fail(`firestore.rules illisible: ${error.message}`); }

try {
  const cloud = read('www/cloud.js');
  for (const marker of ['signInWithCredential','signInWithPopup','signInWithGoogle','skipNativeAuth','GoogleAuthProvider','activateMemberFromRequest','runTransaction']) {
    if (cloud.includes(marker)) ok(`cloud.js conserve ${marker}`); else fail(`cloud.js: marqueur fonctionnel absent (${marker})`);
  }
} catch (error) { fail(`www/cloud.js illisible: ${error.message}`); }

try {
  const workflow = read('.github/workflows/apk.yml');
  if (/permissions:\s*[\s\S]{0,160}contents:\s*write/.test(workflow) || /permissions:\s*[\s\S]{0,160}actions:\s*write/.test(workflow)) fail('apk.yml: permissions write globales à réduire'); else ok('apk.yml: permissions globales limitées');
  const installs = workflow.split(/\r?\n/).filter((line) => /npm install/.test(line) && !/npm install -g firebase-tools@13\.29\.1/.test(line));
  if (installs.length) fail('apk.yml: installation npm non verrouillée détectée'); else ok('apk.yml: aucune installation npm non verrouillée');
  for (const secret of ['GOOGLE_SERVICES_JSON','ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD']) {
    if (workflow.includes(`secrets.${secret}`)) ok(`apk.yml référence le secret ${secret}`); else fail(`apk.yml ne référence pas explicitement le secret ${secret}`);
  }
} catch (error) { fail(`apk.yml illisible: ${error.message}`); }

try {
  const ignore = read('.gitignore').split(/\r?\n/).map((line) => line.trim());
  for (const pattern of ['google-services.json','*.keystore','*.jks','.env']) if (ignore.includes(pattern)) ok(`.gitignore protège ${pattern}`); else fail(`.gitignore ne protège pas explicitement ${pattern}`);
} catch (error) { fail(`.gitignore illisible: ${error.message}`); }

if (failures.length) { console.error(`\n${failures.length} contrôle(s) en échec.`); process.exit(1); }
console.log('\nAudit statique réussi.');
