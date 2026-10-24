#!/usr/bin/env node
/* Audit statique sans accès réseau ni secrets.
   Bloque les erreurs fréquentes de configuration avant un build/publication. */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function ok(message) {
  console.log(`OK   ${message}`);
}

function assertFile(relativePath) {
  try {
    fs.accessSync(path.join(root, relativePath), fs.constants.R_OK);
    ok(`${relativePath} présent`);
  } catch {
    fail(`${relativePath} absent ou illisible`);
  }
}

['firestore.rules', 'firebase.json', 'capacitor.config.json', 'package-lock.json'].forEach(assertFile);

try {
  const rules = read('firestore.rules');
  if (!/rules_version\s*=\s*['"]2['"]\s*;/.test(rules)) {
    fail('firestore.rules doit utiliser rules_version = \'2\'');
  } else {
    ok('Firestore Rules version 2');
  }

  if (/allow\s+(read|write|create|update|delete)\s*:\s*if\s*true\s*;/.test(rules)) {
    fail('Firestore contient une autorisation inconditionnelle');
  } else {
    ok('aucune autorisation Firestore inconditionnelle détectée');
  }

  if (/allow\s+read\s*,\s*write\s*:\s*if\s*true\s*;/.test(rules)) {
    fail('Firestore autorise toutes les lectures et écritures');
  }
} catch (error) {
  fail(`lecture de firestore.rules impossible: ${error.message}`);
}

try {
  const workflow = read('.github/workflows/apk.yml');
  if (/GOOGLE_SERVICES_JSON\s*:\s*['"]?[^$\n]+/.test(workflow)) {
    fail('une valeur GOOGLE_SERVICES_JSON semble codée en dur dans le workflow');
  } else {
    ok('GOOGLE_SERVICES_JSON est référencé via les secrets ou variables GitHub');
  }

  if (/ANDROID_KEYSTORE_PASSWORD\s*:\s*['"]?[^$\n]+/.test(workflow)) {
    fail('un mot de passe de keystore semble codé en dur dans le workflow');
  } else {
    ok('aucun mot de passe de keystore codé en dur détecté');
  }
} catch (error) {
  fail(`lecture du workflow impossible: ${error.message}`);
}

try {
  const gitignore = read('.gitignore');
  for (const pattern of ['google-services.json', '*.keystore', '*.jks', '.env']) {
    if (!gitignore.split(/\r?\n/).some((line) => line.trim() === pattern)) {
      fail(`.gitignore ne protège pas explicitement ${pattern}`);
    }
  }
  if (!failures.length) ok('secrets et certificats protégés par .gitignore');
} catch (error) {
  fail(`lecture de .gitignore impossible: ${error.message}`);
}

if (failures.length) {
  console.error(`\n${failures.length} contrôle(s) de sécurité en échec.`);
  process.exit(1);
}

console.log('\nAudit statique de sécurité réussi.');
