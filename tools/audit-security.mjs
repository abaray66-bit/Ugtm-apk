#!/usr/bin/env node
/* Audit statique local : aucune lecture de secret ni accès réseau. */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function ok(message) {
  console.log(`OK   ${message}`);
}

for (const file of ['package.json', 'package-lock.json', 'firestore.rules', 'firebase.json', 'capacitor.config.json']) {
  if (fs.existsSync(path.join(root, file))) ok(`${file} présent`);
  else fail(`${file} absent`);
}

try {
  const packageJson = JSON.parse(read('package.json'));
  JSON.parse(read('package-lock.json'));
  if (!packageJson.scripts?.check) fail('package.json: script check absent');
  else ok('script de vérification présent');
} catch (error) {
  fail(`JSON package/package-lock invalide: ${error.message}`);
}

try {
  const rules = read('firestore.rules');
  if (!/rules_version\s*=\s*["']2["']\s*;/.test(rules)) fail('firestore.rules: rules_version 2 absente');
  else ok('Firestore Rules version 2');
  if (/allow\s+(?:read|write|create|update|delete|read\s*,\s*write)\s*:\s*if\s+true\s*;/.test(rules)) fail('firestore.rules: autorisation inconditionnelle détectée');
  else ok('Firestore: aucune autorisation inconditionnelle détectée');
} catch (error) {
  fail(`firestore.rules illisible: ${error.message}`);
}

try {
  const ignore = read('.gitignore').split(/\r?\n/).map((line) => line.trim());
  for (const pattern of ['google-services.json', '*.keystore', '*.jks', '.env']) {
    if (ignore.includes(pattern)) ok(`.gitignore protège ${pattern}`);
    else fail(`.gitignore ne protège pas explicitement ${pattern}`);
  }
} catch (error) {
  fail(`.gitignore illisible: ${error.message}`);
}

if (failures.length) {
  console.error(`\n${failures.length} contrôle(s) en échec.`);
  process.exit(1);
}

console.log('\nAudit statique réussi.');
