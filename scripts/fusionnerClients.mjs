/**
 * fusionnerClients.mjs — fusionner les fiches qui désignent le même commerce.
 *
 * DRY-RUN PAR DÉFAUT. Sans `--execute`, ce script ne touche à rien : il lit,
 * décide et décrit. C'est le mode qu'on lance pour savoir ce qui se passerait.
 *
 * LA RÈGLE : L'IDENTIFIANT AGENT, ET LUI SEUL
 * ───────────────────────────────────────────
 * Le code d'abord, le numéro à défaut — la règle de la boutique. Ni le nom, ni
 * le téléphone : l'audit du 2026-10-11 a mesuré que douze fiches « CISSE ADAMA »
 * sur un même téléphone sont douze commerces, chacun avec son code agent. Une
 * fusion par nom+téléphone en aurait effacé onze.
 *
 * LES QUATRE VERROUS POUR ÉCRIRE EN PRODUCTION
 * ────────────────────────────────────────────
 *   1. --execute
 *   2. --allow-production
 *   3. AKAYIS_ALLOW_CLIENT_MERGE='true'
 *   4. le projectId tapé au clavier, sur un vrai terminal
 *
 * ⚠ LE VERROU 3 EST PROPRE À CETTE OPÉRATION. La garde `resolveResetProject`
 *   est partagée avec la remise à zéro, mais sa variable d'environnement ne
 *   l'est pas : déverrouiller un reset ne doit pas déverrouiller une fusion de
 *   clients, et réciproquement. La garde ne connaît que le paramètre, pas le nom
 *   de la variable — c'est ce qui permet un verrou par opération.
 *
 * L'ORDRE DES ÉCRITURES NE SE DISCUTE PAS
 * ───────────────────────────────────────
 * Repointer, puis compléter, puis supprimer. Jamais l'inverse : une fiche
 * supprimée avant que ses opérations ne soient repointées laisse des
 * transactions rattachées à un identifiant qui n'existe plus, et plus rien ne
 * dit à qui elles appartenaient. Chaque grappe est écrite dans UNE transaction,
 * donc une interruption laisse les grappes faites cohérentes et les autres
 * intactes.
 *
 * LES QUATRE LOTS
 * ───────────────
 *   A. noms identiques, et les perdantes ne portent aucune opération ;
 *   B. même identifiant, mais il faut repointer des opérations et/ou reporter
 *      le nom le plus complet (c'est ainsi que les annotations survivent) ;
 *   C. doublon franc isolé dans une grappe à intruses — les intruses restent ;
 *   D. noms sans aucun rapport, grappe réduite à une fiche sur décision de la
 *      boutique. La survivante GARDE SON NOM ; les noms abandonnés sont écrits
 *      dans le journal d'audit et affichés avant d'écrire.
 *
 * ⚠ C ET D NE SE COMBINENT PAS. D réduit la grappe entière, C n'en fusionnait
 *   que les doublons de nom exact : les demander ensemble planifierait deux fois
 *   les mêmes suppressions. Le script refuse la combinaison au lieu de choisir.
 *
 * Usage :
 *   node scripts/fusionnerClients.mjs                       # dry-run, lots A et B
 *   node scripts/fusionnerClients.mjs --lot=D               # dry-run du lot D seul
 *   node scripts/fusionnerClients.mjs --execute --allow-production --lot=A
 *
 * Options :
 *   --lot=        A, B, C, D ou toute combinaison sans répétition (défaut : AB)
 *   --backup-dir= où écrire la sauvegarde (défaut : backups/fusion-<horodatage>)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveResetProject, PRODUCTION_PROJECT_ID } from './lib/assertResetProject.mjs'
import { echouerAvecAide } from './lib/aideIdentifiants.mjs'
import { grapperPar, REGLES, compterOperations } from './lib/doublonsClients.mjs'
import { planifierFusion, verifierSauvegarde } from './lib/fusionClients.mjs'

const argv = process.argv.slice(2)
const valeur = (prefixe, defaut) => {
  const trouve = argv.find((a) => a.startsWith(prefixe))
  return trouve ? trouve.slice(prefixe.length) : defaut
}

const execute = argv.includes('--execute')
const allowProductionFlag = argv.includes('--allow-production')
const lotsVoulus = valeur('--lot=', 'AB').toUpperCase()
const backupDirArg = valeur('--backup-dir=', null)

if (!/^[ABCD]{1,4}$/.test(lotsVoulus) || new Set(lotsVoulus).size !== lotsVoulus.length) {
  console.error(
    `Valeur de --lot invalide : « ${lotsVoulus} ».\n`
    + 'Attendu : une combinaison sans répétition de A, B, C et D — par exemple A, AB, BD, ABD.',
  )
  process.exit(1)
}

// ⚠ Voir l'en-tête : D réduit la grappe entière, C n'en prenait qu'une partie.
if (lotsVoulus.includes('C') && lotsVoulus.includes('D')) {
  console.error(
    'Les lots C et D ne se combinent pas.\n'
    + 'D réduit à une fiche la grappe ENTIÈRE dont les noms n\'ont rien en commun ;\n'
    + 'C n\'en fusionnait que les doublons de nom exact. Les demander ensemble\n'
    + 'planifierait deux fois les mêmes suppressions. Choisir C ou D, pas les deux.',
  )
  process.exit(1)
}

// `echouer` reste pour ce qui ne concerne PAS les identifiants — un dossier de
// sauvegarde occupé, un terminal absent, une confirmation ratée : y afficher
// l'aide d'authentification noierait le vrai message.
const echouer = (message) => {
  console.error('')
  console.error(message)
  process.exit(1)
}

// ── Identifiants ────────────────────────────────────────────────────────────
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
let serviceAccount = null

if (serviceAccountPath) {
  try {
    serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  } catch (error) {
    echouerAvecAide(`Identifiants illisibles :\n  ${serviceAccountPath}\n  (${error.message})`)
  }
} else if (!process.env.GCLOUD_PROJECT) {
  echouerAvecAide('Ni GOOGLE_APPLICATION_CREDENTIALS ni GCLOUD_PROJECT ne sont définis.')
}

let projectId
let isProduction
try {
  ;({ projectId, isProduction } = resolveResetProject({
    serviceAccount,
    envProjectId: process.env.GCLOUD_PROJECT,
    execute,
    allowProductionFlag,
    // ⚠ Variable PROPRE à la fusion : voir l'en-tête, verrou 3.
    envAllowProductionReset: process.env.AKAYIS_ALLOW_CLIENT_MERGE,
  }))
} catch (error) {
  echouerAvecAide(`Projet refusé : ${error.message}`)
}

if (!isProduction && !projectId.startsWith('demo-')) {
  echouer(
    `Projet refusé : « ${projectId} ».\n`
    + 'Ce script ne fusionne que la production de ce dépôt ou un projet demo-*.',
  )
}

// ── Verrou 4 : la confirmation au clavier ───────────────────────────────────
if (execute && isProduction) {
  if (!process.stdin.isTTY) {
    echouer(
      'REFUS : fusionner en PRODUCTION exige une confirmation tapée au clavier.\n'
      + "Le flux d'entrée n'est pas un terminal (pipe, CI). Opération bloquée.",
    )
  }
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const reponse = await rl.question(
    'ATTENTION : SUPPRESSION DE FICHES CLIENTS en PRODUCTION.\n'
    + `Tapez exactement le projectId (${PRODUCTION_PROJECT_ID}) pour confirmer : `,
  )
  rl.close()
  if (reponse.trim() !== PRODUCTION_PROJECT_ID) {
    echouer('Confirmation invalide. Aucune écriture effectuée.')
  }
}

initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
const db = getFirestore()

const nombre = (n) => Number(n).toLocaleString('fr-FR')
const titre = (texte) => {
  console.log('')
  console.log(texte)
  console.log('─'.repeat(texte.length))
}

console.log(`Projet : ${projectId}${isProduction ? '  (PRODUCTION)' : ''}`)
console.log(`Mode   : ${execute ? '⚠ EXECUTE — des fiches vont être supprimées' : 'dry-run (aucune écriture)'}`)
console.log(`Lots   : ${lotsVoulus}`)

// ── Lecture ─────────────────────────────────────────────────────────────────
const snap = await db.collection('globalClients').get()
const fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

const storeIds = [...new Set(fiches.map((f) => f.registeredStoreId).filter(Boolean))]
const operations = []
for (const storeId of storeIds) {
  for (const collection of ['history', 'drafts']) {
    const lot = await db.collection(`clients/${storeId}/${collection}`).get()
    for (const doc of lot.docs) {
      operations.push({ chemin: doc.ref.path, clientId: doc.data().clientId ?? null, donnees: doc.data() })
    }
  }
}

// `storeCollaborations` porte un clientId sans rien écrire dans `history` : une
// fiche peut n'avoir « aucune opération » et être pourtant référencée.
const collabs = await db.collection('storeCollaborations').get()
for (const doc of collabs.docs) {
  operations.push({ chemin: doc.ref.path, clientId: doc.data().clientId ?? null, donnees: doc.data() })
}

console.log(`Lu     : ${nombre(fiches.length)} fiche(s), ${nombre(operations.length)} référence(s)`)

// ── Décision ────────────────────────────────────────────────────────────────
const references = compterOperations(operations)
const regleAgent = REGLES.find((r) => r.cle === 'agent')
const { grappes } = grapperPar(regleAgent, fiches)
const plan = planifierFusion(grappes, references, { fusionnerSansRapport: lotsVoulus.includes('D') })

const lots = []
if (lotsVoulus.includes('A')) lots.push(...plan.lotA)
if (lotsVoulus.includes('B')) lots.push(...plan.lotB)
if (lotsVoulus.includes('C')) lots.push(...plan.lotC)
if (lotsVoulus.includes('D')) lots.push(...plan.lotD)

titre('CE QUE LA FUSION FERAIT')
console.log(`Grappes partageant un identifiant agent : ${nombre(grappes.length)}`)
console.log('')
console.log(`  Lot A — noms identiques, rien à déplacer  : ${nombre(plan.lotA.length)} grappe(s)`)
console.log(`  Lot B — repointage et/ou report de nom    : ${nombre(plan.lotB.length)} grappe(s)`)
console.log(`  Lot C — doublon franc isolé dans une grappe à intruses : ${nombre(plan.lotC.length)} sous-grappe(s)`)
console.log(`  Lot D — noms sans rapport, réduite à une fiche          : ${nombre(plan.lotD.length)} grappe(s)`)
// ⚠ DEUX SORTES DE RESTES, ET « RIEN À EN TIRER » SERAIT FAUX POUR L'UNE.
//   Une grappe scindée laisse ses intruses non fusionnées : elles comptent parmi
//   les restes, mais leur grappe A ÉTÉ traitée en partie. Les confondre avec les
//   grappes dont rien ne se récupère ferait croire que le lot C n'a rien donné.
const intruses = plan.ecartees.filter((e) => e.raison.startsWith('intruses'))
const sansRapport = plan.ecartees.filter((e) => !e.raison.startsWith('intruses'))
console.log(`  Restes — intruses de grappes scindées, laissées intactes : ${nombre(intruses.length)}`)
console.log(`  Restes — grappes dont rien ne se récupère, JAMAIS touchées : ${nombre(sansRapport.length)}`)
console.log('')
// ⚠ COMPTER LES OPÉRATIONS, PAS SEULEMENT LES FICHES QUI LES PORTENT.
//   La première version annonçait « 32 perdantes dont les opérations seront
//   repointées » puis concluait « 79 opérations repointées ». Les deux chiffres
//   sont justes et ne mesurent pas la même chose — une perdante peut porter huit
//   opérations. Mais le dry-run taisait ainsi le seul chiffre qui dimensionne le
//   risque : combien de transactions vont CHANGER DE TITULAIRE. On annonce
//   désormais les deux, et le résultat final devient comparable au dry-run.
const parClient = new Map()
for (const operation of operations) {
  if (!operation.clientId) continue
  if (!parClient.has(operation.clientId)) parClient.set(operation.clientId, [])
  parClient.get(operation.clientId).push(operation)
}

const supprimables = lots.reduce((n, p) => n + p.perdantes.length, 0)
const perdantesServant = lots.reduce((n, p) => n + p.perdantesReferencees.length, 0)
const operationsADeplacer = lots.reduce(
  (n, p) => n + p.perdantes.reduce((m, perdante) => m + (parClient.get(perdante.id)?.length ?? 0), 0),
  0,
)
const reports = lots.filter((p) => p.nomAReporter).length
console.log(`Sur les lots retenus (${lotsVoulus}) :`)
console.log(`  ${nombre(supprimables)} fiche(s) supprimée(s)`)
console.log(`  ${nombre(operationsADeplacer)} opération(s) à repointer, portées par ${nombre(perdantesServant)} perdante(s)`)
console.log(`  ${nombre(reports)} nom(s) reporté(s) sur la survivante`)

// ⚠ LE SEUL ENDROIT DE TOUTE LA FUSION OÙ UN NOM DISPARAÎT POUR DE BON.
//   Partout ailleurs, le nom abandonné était une autre écriture de celui qui
//   reste. Dans le lot D c'est un nom étranger : il faut pouvoir le lire AVANT
//   d'écrire, pas le découvrir dans le journal après. On les affiche tous — pas
//   un échantillon : c'est la liste exhaustive de ce que la boutique perd.
const abandons = lots.flatMap((p) => p.nomsAbandonnes.map((nom) => ({
  cle: p.cle,
  garde: `${p.survivante.nom ?? ''} ${p.survivante.prenom ?? ''}`.trim(),
  perdu: nom,
})))
if (abandons.length > 0) {
  console.log(`  ${nombre(abandons.length)} nom(s) ABANDONNÉ(S) — la survivante garde le sien`)
  console.log('')
  console.log('Noms abandonnés (gardé ← abandonné) :')
  for (const a of abandons) console.log(`  ${a.garde}  ←  ${a.perdu}`)
}

// Dans le lot D, une perdante qui porte des opérations fait changer de titulaire
// des transactions entre deux noms SANS RAPPORT. C'est le cas que l'arbitrage
// avait mis de côté ; il est désormais assumé, mais il se compte.
const titulairesChanges = lots
  .filter((p) => p.lot === 'D')
  .reduce((n, p) => n + p.perdantes.reduce((m, perdante) => m + (parClient.get(perdante.id)?.length ?? 0), 0), 0)
if (titulairesChanges > 0) {
  console.log('')
  console.log(`⚠ ${nombre(titulairesChanges)} opération(s) du lot D changent de titulaire entre deux noms sans rapport.`)
}

const exemples = lots.filter((p) => p.nomAReporter).slice(0, 5)
if (exemples.length > 0) {
  console.log('')
  console.log('Exemples de report de nom (c\'est ainsi que les annotations survivent) :')
  for (const p of exemples) {
    console.log(`  ${p.survivante.nom} ${p.survivante.prenom}`)
    console.log(`    → ${p.nomAReporter.nom} ${p.nomAReporter.prenom}`)
  }
}

const exemplesC = plan.lotC.slice(0, 5)
if (exemplesC.length > 0) {
  console.log('')
  console.log('Exemples de lot C (le doublon est fusionné, l\'intruse reste intacte) :')
  for (const p of exemplesC) {
    const noms = [p.survivante, ...p.perdantes].map((m) => `${m.nom} ${m.prenom}`).join(' · ')
    console.log(`  ${noms}`)
  }
}

if (plan.ecartees.length > 0) {
  console.log('')
  console.log('Écartées — à décider par la boutique :')
  for (const e of plan.ecartees.slice(0, 5)) {
    console.log(`  [${e.raison}] ${e.membres.map((m) => `${m.nom} ${m.prenom}`).join(' · ')}`)
  }
  if (plan.ecartees.length > 5) console.log(`  … et ${nombre(plan.ecartees.length - 5)} autre(s).`)
}

if (!execute) {
  titre('DRY-RUN — AUCUNE ÉCRITURE')
  console.log('Aucune fiche supprimée, aucune opération déplacée, aucune sauvegarde créée.')
  console.log('Pour exécuter réellement, voir l\'en-tête du script : quatre verrous.')
  process.exit(0)
}

if (lots.length === 0) {
  titre('RIEN À FAIRE')
  console.log('Aucune grappe dans les lots retenus.')
  process.exit(0)
}

// ── Garde : une perdante ne doit porter aucune sous-collection ──────────────
//
// ⚠ `delete()` NE SUPPRIME PAS LES SOUS-COLLECTIONS. Elles survivraient à leur
//   document parent, invisibles dans la console comme dans l'application, et
//   impossibles à retrouver sans connaître leur chemin exact. Le périmètre de ce
//   script ne les couvre pas : s'il en existe, c'est le script qu'il faut
//   corriger, pas la donnée qu'il faut perdre.
titre('VÉRIFICATION DES SOUS-COLLECTIONS')
const perdantes = lots.flatMap((p) => p.perdantes)
console.log(`Inspection de ${nombre(perdantes.length)} fiche(s) à supprimer ...`)
const avecSousCollections = []
for (const perdante of perdantes) {
  const sous = await db.doc(`globalClients/${perdante.id}`).listCollections()
  if (sous.length > 0) avecSousCollections.push(`${perdante.id} → ${sous.map((c) => c.id).join(', ')}`)
}
if (avecSousCollections.length > 0) {
  console.error('ABANDON : des fiches à supprimer portent des sous-collections :')
  for (const ligne of avecSousCollections) console.error(`  ⚠ ${ligne}`)
  echouer('Aucune écriture effectuée. Mettre à jour le périmètre du script.')
}
console.log('Aucune sous-collection. Le périmètre du script couvre tout.')

// ── Sauvegarde, puis RELECTURE, puis vérification ───────────────────────────
const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = backupDirArg ?? join('backups', `fusion-${horodatage}`)

try {
  const existant = await readdir(backupDir)
  if (existant.length > 0) echouer(`ABANDON : ${backupDir} existe déjà et n'est pas vide.`)
} catch { /* le dossier n'existe pas : c'est le cas normal */ }

await mkdir(backupDir, { recursive: true })
titre('SAUVEGARDE')
console.log(`Vers ${backupDir} ...`)

const idsConcernes = new Set(lots.flatMap((p) => [p.survivante.id, ...p.perdantes.map((m) => m.id)]))
const fichesASauver = fiches.filter((f) => idsConcernes.has(f.id))
const operationsASauver = operations.filter((o) => o.clientId && idsConcernes.has(o.clientId))

await writeFile(join(backupDir, 'fiches.json'), JSON.stringify(fichesASauver, null, 2), 'utf8')
await writeFile(join(backupDir, 'operations.json'), JSON.stringify(operationsASauver, null, 2), 'utf8')
await writeFile(join(backupDir, 'manifest.json'), JSON.stringify({
  projectId,
  script: 'scripts/fusionnerClients.mjs',
  argv,
  creeLe: new Date().toISOString(),
  lots: lotsVoulus,
  grappes: lots.length,
  fiches: fichesASauver.length,
  operations: operationsASauver.length,
}, null, 2), 'utf8')

// ⚠ RELECTURE DEPUIS LE DISQUE. Vérifier la variable en mémoire ne prouverait
//   rien : ce qu'il faut savoir, c'est que le FICHIER est lisible et complet.
const fichesRelues = JSON.parse(await readFile(join(backupDir, 'fiches.json'), 'utf8'))
const operationsRelues = JSON.parse(await readFile(join(backupDir, 'operations.json'), 'utf8'))
console.log(`Relu : ${nombre(fichesRelues.length)} fiche(s), ${nombre(operationsRelues.length)} opération(s)`)

// La porte ne vérifie QUE les lots retenus : exiger la sauvegarde de grappes
// qu'on ne va pas toucher ferait abandonner un `--lot=A` parfaitement sûr.
const manques = verifierSauvegarde({
  plan: {
    lotA: lotsVoulus.includes('A') ? plan.lotA : [],
    lotB: [
      ...(lotsVoulus.includes('B') ? plan.lotB : []),
      ...(lotsVoulus.includes('C') ? plan.lotC : []),
      ...(lotsVoulus.includes('D') ? plan.lotD : []),
    ],
  },
  fichesSauvees: fichesRelues,
  operationsSauvees: operationsRelues,
})
if (manques.length > 0) {
  console.error('ABANDON : la sauvegarde ne couvre pas ce que la fusion détruirait :')
  for (const manque of manques.slice(0, 20)) console.error(`  ✗ ${manque}`)
  echouer('Aucune écriture effectuée. Relancer quand l\'application est inactive.')
}
console.log('Sauvegarde vérifiée. La fusion peut écrire.')

// ── Écriture, une transaction par grappe ────────────────────────────────────
titre('FUSION')
const LIMITE_ECRITURES = 400
let fusionnees = 0
let supprimees = 0
let repointees = 0
const incidents = []

for (const p of lots) {
  const aRepointer = p.perdantes.flatMap((m) => parClient.get(m.id) ?? [])
  const ecritures = aRepointer.length + 1 + p.perdantes.length + 1
  if (ecritures > LIMITE_ECRITURES) {
    incidents.push(`${p.cle} : ${ecritures} écritures, au-delà de la limite d'une transaction`)
    continue
  }

  try {
    await db.runTransaction(async (t) => {
      const survivanteRef = db.doc(`globalClients/${p.survivante.id}`)
      const survivanteSnap = await t.get(survivanteRef)
      if (!survivanteSnap.exists) throw new Error('la survivante a disparu')

      // Relire les perdantes : une relance après interruption doit ignorer
      // celles qui sont déjà parties, au lieu d'échouer sur un delete.
      const presentes = []
      for (const perdante of p.perdantes) {
        const ref = db.doc(`globalClients/${perdante.id}`)
        if ((await t.get(ref)).exists) presentes.push({ perdante, ref })
      }
      if (presentes.length === 0) return

      // 1. REPOINTER — avant toute suppression, sans exception.
      for (const operation of aRepointer) {
        t.update(db.doc(operation.chemin), { clientId: p.survivante.id })
      }

      // 2. COMPLÉTER la survivante : le nom le plus complet porte les
      //    annotations (« INTERDIT », « PAS DE DEPOT »), et les champs vides se
      //    remplissent sans jamais écraser ce qui existe.
      const maj = { ...p.champsACompleter }
      if (p.nomAReporter) {
        maj.nom = p.nomAReporter.nom
        maj.prenom = p.nomAReporter.prenom
      }
      if (Object.keys(maj).length > 0) t.update(survivanteRef, maj)

      // 3. SUPPRIMER les perdantes.
      for (const { ref } of presentes) t.delete(ref)

      // 4. La piste d'audit, dans la boutique de la survivante.
      const storeId = p.survivante.registeredStoreId
      if (storeId) {
        t.set(db.collection(`clients/${storeId}/auditLogs`).doc(), {
          action: 'CLIENT_MERGED',
          actorUid: null,
          actorRole: 'script',
          actorScript: 'scripts/fusionnerClients.mjs',
          lot: p.lot,
          identifiantAgent: p.cle,
          survivanteId: p.survivante.id,
          perdantesIds: presentes.map(({ perdante }) => perdante.id),
          operationsRepointees: aRepointer.map((o) => o.chemin),
          nomAvant: `${p.survivante.nom ?? ''} ${p.survivante.prenom ?? ''}`.trim(),
          nomApres: p.nomAReporter
            ? `${p.nomAReporter.nom} ${p.nomAReporter.prenom}`.trim()
            : null,
          // Le lot D est le seul où un nom étranger disparaît : le journal le
          // nomme, sinon la sauvegarde serait le seul endroit où le retrouver.
          nomsAbandonnes: p.nomsAbandonnes,
          champsCompletes: Object.keys(p.champsACompleter),
          sauvegarde: backupDir,
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      fusionnees += 1
      supprimees += presentes.length
      repointees += aRepointer.length
    })
  } catch (error) {
    incidents.push(`${p.cle} : ${error.message}`)
  }
}

titre('RÉSULTAT')
console.log(`${nombre(fusionnees)} grappe(s) fusionnée(s)`)
console.log(`${nombre(supprimees)} fiche(s) supprimée(s)`)
console.log(`${nombre(repointees)} opération(s) repointée(s)`)
if (abandons.length > 0) console.log(`${nombre(abandons.length)} nom(s) abandonné(s) — relisibles dans le journal et la sauvegarde`)
console.log(`Sauvegarde : ${backupDir}`)
if (incidents.length > 0) {
  console.log('')
  console.log(`⚠ ${nombre(incidents.length)} grappe(s) non traitée(s) :`)
  for (const incident of incidents.slice(0, 20)) console.log(`  ✗ ${incident}`)
  console.log('Chaque grappe est écrite dans sa propre transaction : celles-ci sont')
  console.log('restées INTACTES, les autres sont cohérentes. Le script est relançable.')
}
