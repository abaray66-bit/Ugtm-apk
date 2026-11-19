/* Script de migration des anciens signalements
   ------------------------------------------------------------
   Usage : node tools/migrate-reports.mjs [--dry-run]
   
   Ce script :
   1. Lit tous les reports existants.
   2. Pour chaque report sans structureId, tente de trouver
      la structure correspondante par etab.
   3. Pose structureId si la correspondance est certaine.
   4. Crée une intervention initiale (seq: 0) de type 'system'
      résumant l'état actuel.
   5. Si response non vide, crée une intervention 'admin_note'.
   
   IMPORTANT : ce script ne modifie jamais les données de production
   directement. Il génère un fichier JSON de migration à appliquer
   manuellement ou via un script séparé.
   
   Lancement en dry-run :
     node tools/migrate-reports.mjs --dry-run
*/

import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');

console.log('=== Migration des signalements ===');
console.log('Mode :', DRY_RUN ? 'DRY-RUN (aucune modification)' : 'PRODUCTION (modifications réelles)');
console.log('');

// Les données de test sont chargées depuis un fichier JSON
// généré par l'export Firestore.
// Format attendu : { reports: [...], structures: [...] }

const inputFile = process.argv.find(a => a.endsWith('.json') && !a.includes('migrate'));
if (!inputFile) {
  console.log('Usage : node tools/migrate-reports.mjs [--dry-run] <export.json>');
  console.log('');
  console.log('Le fichier export.json doit contenir :');
  console.log('  { "reports": [...], "structures": [...] }');
  console.log('');
  console.log('Pour exporter les données depuis Firestore :');
  console.log('  firebase firestore:export gs://bucket/path --collection-ids=reports,localStructures');
  process.exit(0);
}

const data = JSON.parse(readFileSync(inputFile, 'utf8'));
const reports = data.reports || [];
const structures = data.structures || [];

// Index des structures par etab
const structByEtab = {};
structures.forEach(s => {
  if (s.etab) structByEtab[s.etab] = s;
  if (s.name) structByEtab[s.name] = s;
});

const migration = {
  reports: [],
  interventions: [],
  stats: {
    total: reports.length,
    withStructureId: 0,
    withoutStructureId: 0,
    ambiguous: 0,
    interventionsCreated: 0
  }
};

reports.forEach(report => {
  const entry = {
    id: report.id,
    original: { ...report },
    updates: {},
    interventions: []
  };

  // 1. Renseigner structureId si absent
  if (!report.structureId) {
    const struct = structByEtab[report.etab];
    if (struct && struct.structureId) {
      entry.updates.structureId = struct.structureId;
      migration.stats.withStructureId++;
    } else {
      entry.updates.structureId = '';
      migration.stats.withoutStructureId++;
      if (report.etab) {
        migration.stats.ambiguous++;
        entry.note = 'Structure non identifiée pour etab: ' + report.etab;
      }
    }
  } else {
    migration.stats.withStructureId++;
  }

  // 2. Renseigner interventionLevel si absent
  if (!report.interventionLevel) {
    entry.updates.interventionLevel = 'local';
  }

  // 3. Renseigner les champs d'affectation si absents
  if (report.assignedTo === undefined) entry.updates.assignedTo = '';
  if (report.assignedStructure === undefined) entry.updates.assignedStructure = '';
  if (report.assignedProvince === undefined) entry.updates.assignedProvince = '';
  if (report.memberResponsePending === undefined) entry.updates.memberResponsePending = false;

  // 4. Créer intervention initiale (system)
  entry.interventions.push({
    reportId: report.id,
    seq: 0,
    authorUid: 'system',
    authorRole: 'admin',
    authorName: 'Système (migration)',
    type: 'system',
    level: 'local',
    content: 'Dossier migré. Statut initial : ' + (report.status || 'new'),
    attachmentIds: [],
    statusBefore: report.status || 'new',
    statusAfter: report.status || 'new',
    isSystem: true
  });
  migration.stats.interventionsCreated++;

  // 5. Si response non vide, créer intervention admin_note
  if (report.response && report.response.trim().length > 0) {
    entry.interventions.push({
      reportId: report.id,
      seq: 1,
      authorUid: 'system',
      authorRole: 'admin',
      authorName: 'Système (migration)',
      type: 'admin_note',
      level: 'local',
      content: report.response,
      attachmentIds: [],
      statusBefore: report.status || 'new',
      statusAfter: report.status || 'new',
      isSystem: true
    });
    migration.stats.interventionsCreated++;
  }

  migration.reports.push(entry);
  migration.interventions.push(...entry.interventions);
});

// Écrire le fichier de migration
const outputFile = 'migration-reports-' + Date.now() + '.json';
writeFileSync(outputFile, JSON.stringify(migration, null, 2));

console.log('Statistiques :');
console.log('  Total reports :', migration.stats.total);
console.log('  Avec structureId :', migration.stats.withStructureId);
console.log('  Sans structureId :', migration.stats.withoutStructureId);
console.log('  Ambigus :', migration.stats.ambiguous);
console.log('  Interventions créées :', migration.stats.interventionsCreated);
console.log('');
console.log('Fichier de migration généré :', outputFile);
console.log('Mode :', DRY_RUN ? 'DRY-RUN' : 'PRODUCTION');

if (DRY_RUN) {
  console.log('');
  console.log('Pour appliquer la migration, relancez sans --dry-run');
  console.log('et utilisez le fichier JSON généré avec un script d\'import Firestore.');
}