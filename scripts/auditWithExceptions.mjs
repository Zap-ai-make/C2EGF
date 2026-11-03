/**
 * auditWithExceptions.mjs — `npm audit` avec des exceptions NOMMÉES et DATÉES.
 *
 * Pourquoi ce script plutôt qu'un `npm audit` nu : la chaîne `quality:check`
 * échouait sur un avis qui n'expose pas ce produit (voir EXCEPTIONS). Un filet
 * rouge en permanence est un filet qu'on finit par contourner — donc on nomme
 * l'exception, on dit pourquoi, et on la fait expirer d'elle-même.
 *
 * Pourquoi pas un `overrides` sur la dépendance : `@firebase/firestore` déclare
 * `@grpc/grpc-js: ~1.9.0`. Forcer 1.13.6 sortirait de quatre versions mineures
 * hors de la plage déclarée par l'éditeur — et la dernière version de Firebase
 * (13.1.0) déclare toujours la même plage. On échangerait un risque de stabilité
 * réel contre un gain de sécurité nul.
 *
 * Deux comportements qui font la valeur du script :
 *   - un avis haut/critique NON listé fait échouer (c'est le filet) ;
 *   - une exception DEVENUE INUTILE fait échouer aussi (c'est l'anti-pourriture :
 *     une exception qu'on oublie de retirer est une porte qu'on oublie de fermer).
 *
 * ⚠ Trois pièges rencontrés, et corrigés — ne pas les réintroduire :
 *   1. La sévérité d'un AVIS et celle de son PAQUET diffèrent. `@grpc/grpc-js`
 *      remonte en `high` à cause d'un seul de ses deux avis ; l'autre est `low`.
 *      On recense donc TOUS les avis vus, quelle que soit leur sévérité, et on
 *      ne BLOQUE que sur `high`/`critical`. Filtrer avant de recenser faisait
 *      passer un avis listé pour une exception périmée.
 *   2. Une exception vaut pour UN répertoire. Les mêmes avis sont corrigés dans
 *      `functions/` et subsistent à la racine : sans `repertoires`, l'audit de
 *      `functions/` les déclarait périmés.
 *   3. Un seul audit ne suffit pas à déclarer une exception périmée : une
 *      réponse a manqué l'avis, deux fois, juste après un `npm install`.
 *      L'audit est relancé une fois avant de conclure (3 novembre 2026).
 *
 * La lecture du rapport vit dans `scripts/lib/analyseAudit.mjs`, testée par
 * TC-325 ; ce script ne garde que l'appel à `npm audit` et l'affichage.
 *
 * Usage : node scripts/auditWithExceptions.mjs [répertoire]
 */

import { spawnSync } from 'node:child_process'

import { confirmerAudit, lireRapport } from './lib/analyseAudit.mjs'

/**
 * Chaque entrée doit porter : l'avis, le paquet, les répertoires concernés, la
 * raison VÉRIFIÉE, la date, et la condition de retrait. Pas de « à voir plus tard ».
 */
const EXCEPTIONS = [
  {
    avis: 'GHSA-m9gg-hp2v-232j',
    paquet: '@grpc/grpc-js',
    repertoires: ['.'],
    raison:
      "Défaut de SERVEUR gRPC : getAuthContext peut valider des certificats non " +
      "autorisés. grpc-js n'est pas dans le bundle navigateur — vérifié, les seules " +
      "occurrences de « grpc » dans dist/ sont la chaîne « grpcFlowControlWindow », " +
      "un nom d'option Firestore. Un navigateur n'héberge pas de serveur gRPC. " +
      "(Le second avis du même paquet, GHSA-f596-whhp-79r4, est classé « low » et " +
      "ne bloque donc pas : inutile de l'excepter.)",
    depuis: '2026-10-23',
    retirer:
      'dès que @firebase/firestore déclarera @grpc/grpc-js >= 1.13.6 ' +
      "(il déclare ~1.9.0 jusqu'en 4.19.0 inclus, soit firebase 13.1.0).",
  },
]

const repertoire = process.argv[2] || '.'
const exceptionsDuRepertoire = EXCEPTIONS.filter((e) => e.repertoires.includes(repertoire))

/** Un rapport lisible, ou l'arrêt du script avec la raison. */
function auditer() {
  const execution = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--json', '--prefix', repertoire],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  )
  const lu = lireRapport(execution.stdout)
  if (lu.erreur) {
    console.error(`Audit impossible dans « ${repertoire} » : ${lu.erreur}.${execution.stderr ? `\n${execution.stderr.trim()}` : ''}`)
    process.exit(1)
  }
  return lu.rapport
}

// ⚠ Piège 2 : seules les exceptions DE CE RÉPERTOIRE peuvent y être périmées.
const { actives, perimees, bloquants, recus } = confirmerAudit(auditer, exceptionsDuRepertoire)

for (const e of actives) {
  console.log(`· exception active : ${e.avis} (${e.paquet}), depuis le ${e.depuis}`)
}

if (perimees.length > 0) {
  console.error(
    `\nExceptions d'audit absentes de deux audits de suite dans « ${repertoire} » ` +
      `(${recus} avis reçus au dernier) — à RETIRER de scripts/auditWithExceptions.mjs :\n` +
      perimees.map((e) => `  ${e.avis} (${e.paquet}) — ${e.retirer}`).join('\n') +
      (recus === 0
        ? "\n\n⚠ Le dernier audit n'a rendu AUCUN avis : relancer `npm audit` à la main avant de retirer quoi que ce soit."
        : ''),
  )
  process.exit(1)
}

if (bloquants.length > 0) {
  console.error(
    `\nAvis haut ou critique sans exception dans « ${repertoire} » :\n` +
      bloquants.map((l) => `  ${l}`).join('\n') +
      '\n\nCorriger, ou ajouter une exception JUSTIFIÉE et DATÉE dans ' +
      'scripts/auditWithExceptions.mjs.',
  )
  process.exit(1)
}

console.log(`Aucun avis haut ou critique non traité dans « ${repertoire} ».`)
