/**
 * auditClients.mjs — ÉTAT DES LIEUX de la liste des clients. LECTURE SEULE.
 *
 * CE SCRIPT N'ÉCRIT RIEN, nulle part, jamais. Il n'a pas de `--execute`, pas de
 * `batch`, pas de `set`. C'est délibéré : avant de supprimer des milliers de
 * fiches, il faut savoir lesquelles et pourquoi, et cette mesure-là ne doit
 * comporter aucun risque. La garde est appelée avec `execute: false`, le mode
 * que `assertResetProject` autorise partout, y compris en production.
 *
 * CE QU'IL RÉPOND
 * ───────────────
 *   1. Combien de fiches, et combien devraient rester sous chacune des quatre
 *      lectures de « doublon » — à rapprocher de l'écart constaté.
 *   2. Pourquoi la colonne « numéro agent » est vide : la distribution des
 *      LONGUEURS des valeurs héritées tranche entre « jamais collecté » et
 *      « mal rangé par la règle des huit chiffres ».
 *   3. Quelles grappes se fusionnent sans effort (une seule fiche porte des
 *      opérations) et lesquelles demanderont de REPOINTER des transactions.
 *
 * Usage :
 *   node scripts/auditClients.mjs [--csv <fichier>] [--boutique <storeId>]
 *
 *   --csv       écrit le détail des grappes, pour juger sur pièces
 *   --boutique  restreint à une boutique (par défaut : toutes)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile, writeFile } from 'node:fs/promises'
import { resolveResetProject } from './lib/assertResetProject.mjs'
import { echouerAvecAide } from './lib/aideIdentifiants.mjs'
import {
  analyserDoublons,
  profilerChamps,
  compterOperations,
  classerGrappes,
  numerosSurRepresentes,
  annotationsObservees,
  fusionsFranches,
  croiserAvecAgent,
  collisionsCodeNumero,
  comparerAuxTelephones,
  chiffres,
} from './lib/doublonsClients.mjs'

const argv = process.argv.slice(2)
const option = (nom) => {
  const i = argv.indexOf(nom)
  return i >= 0 ? argv[i + 1] : undefined
}
const fichierCsv = option('--csv')
const boutiqueVoulue = option('--boutique')

// Le texte d'aide vit dans `lib/aideIdentifiants.mjs` : les quatre scripts
// d'administration demandent les mêmes identifiants, et une session PowerShell
// relancée les perd tous en même temps. Un message par script finirait par
// dériver, et l'un d'eux donnerait la mauvaise commande.
const echouer = echouerAvecAide

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
let serviceAccount = null

if (serviceAccountPath) {
  try {
    serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      echouer(
        `Aucun fichier à cet emplacement :\n  ${serviceAccountPath}\n\n`
        + 'GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du compte de\n'
        + 'service — le chemin réel, pas le texte de remplacement d’un exemple.',
      )
    }
    echouer(`Le fichier d’identifiants n’est pas un JSON lisible :\n  ${serviceAccountPath}\n  (${error.message})`)
  }
} else if (!process.env.GCLOUD_PROJECT) {
  echouer('Ni GOOGLE_APPLICATION_CREDENTIALS ni GCLOUD_PROJECT ne sont définis.')
}

// execute:false → lecture seule. Ce script n'a pas d'autre mode.
//
// La garde refuse aussi un JSON qui n'est PAS une clé de compte de service —
// un `package.json` passe `JSON.parse` sans difficulté. Son message dit
// précisément ce qui manque ; le laisser remonter en trace de pile le rendrait
// illisible pour la seule personne à qui il s'adresse.
let projectId
let isProduction
try {
  ({ projectId, isProduction } = resolveResetProject({
    serviceAccount,
    envProjectId: process.env.GCLOUD_PROJECT,
    execute: false,
  }))
} catch (error) {
  echouer(`Identifiants refusés : ${error.message}`)
}

initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
const db = getFirestore()

const titre = (texte) => {
  console.log('')
  console.log(texte)
  console.log('─'.repeat(texte.length))
}
const nombre = (n) => Number(n).toLocaleString('fr-FR')

/**
 * Les raisons d'écarter une grappe, regroupées par famille.
 *
 * Elles portent un décompte variable (« 3 identifiants agent différents »,
 * « 12 identifiants… ») : sans ce repli, la liste compterait une ligne par
 * variante au lieu d'une par famille, et ne dirait plus rien.
 */
const grouperRaisons = (aRegarder) => {
  const familles = new Map()
  for (const item of aRegarder) {
    const famille = item.raison.replace(/^\d+ /, '')
    familles.set(famille, (familles.get(famille) || 0) + 1)
  }
  return [...familles.entries()].sort((a, b) => b[1] - a[1])
}
const pourcent = (part, total) => (total === 0 ? '0 %' : `${Math.round((part / total) * 100)} %`)

console.log(`Projet : ${projectId}${isProduction ? '  (PRODUCTION — LECTURE SEULE)' : ''}`)

// ⚠ UN PROJET ÉTRANGER EST REFUSÉ, PAS SEULEMENT SIGNALÉ.
//
//   Plusieurs clés de comptes de service traînent vite sur un poste de
//   développement, et rien ne distingue à l'œil le JSON d'un client de celui
//   d'un autre. Or ce script-ci n'est pas une recherche ciblée : il ÉNUMÈRE la
//   base clients entière et sait l'écrire en CSV. Le lancer avec la mauvaise
//   clé ne donnerait pas seulement un rapport inutile — il recopierait le
//   fichier clients d'un tiers sur cette machine. Un avertissement imprimé
//   après coup n'empêche rien ; un refus, si.
//
//   Lecture seule ne veut pas dire sans conséquence.
if (!isProduction && !projectId.startsWith('demo-')) {
  echouer(
    `Projet refusé : « ${projectId} ».\n\n`
    + 'Ce script énumère la base clients entière. Il n’accepte que la production\n'
    + 'de ce dépôt (c2egf-b0b5a) ou un projet demo-*. La clé pointée appartient à\n'
    + 'un autre projet — lire ses clients n’aurait aucun objet ici.',
  )
}

// ── Les fiches ──────────────────────────────────────────────────────────────
const snap = await db.collection('globalClients').get()
let fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
if (boutiqueVoulue) fiches = fiches.filter((f) => f.registeredStoreId === boutiqueVoulue)

titre('1. LES FICHES')
console.log(`globalClients : ${nombre(snap.size)} fiche(s)${boutiqueVoulue ? ` — ${nombre(fiches.length)} dans ${boutiqueVoulue}` : ''}`)

const parBoutique = new Map()
for (const f of fiches) {
  const cle = f.registeredStoreName || f.registeredStoreId || '(sans boutique)'
  parBoutique.set(cle, (parBoutique.get(cle) || 0) + 1)
}
for (const [boutique, n] of [...parBoutique.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(7)}  ${boutique}`)
}

// ── Le remplissage, et la question du numéro agent ──────────────────────────
const profil = profilerChamps(fiches)

titre('2. CE QUI EST RENSEIGNÉ')
for (const [champ, n] of Object.entries(profil.remplissage)) {
  console.log(`  ${String(n).padStart(7)}  ${pourcent(n, profil.total).padStart(5)}  ${champ}`)
}
console.log(`  ${String(profil.sansAucunAgent).padStart(7)}  ${pourcent(profil.sansAucunAgent, profil.total).padStart(5)}  SANS aucune valeur d'agent (ni code, ni numéro, ni orange)`)

// ⚠ CE QUE L'APPLICATION LIT, PAS CE QUE LA BASE CONTIENT.
//
//   La comparaison se fait par CODE agent d'abord, par NUMÉRO à défaut — la
//   règle de la boutique. Et c'est `champsAgent`, la fonction de l'écran, qui
//   décide laquelle des deux une fiche porte. Elle tranche par la PRÉSENCE des
//   clés : une fiche portant `codeAgent: ''` est tenue pour « rangée puis vidée
//   exprès », et son `orange` n'est plus lu — délibérément.
//
//   D'où la ligne « orange jamais lu » : une valeur qui dort en base sans que
//   personne ne la voie. Le seul remplissage de `orange` ne le dirait pas, et un
//   audit qui lirait `orange` inconditionnellement compterait des identités que
//   le logiciel n'utilise pas.
console.log('')
console.log("Identité retenue pour comparer — le CODE d'abord, le NUMÉRO à défaut :")
console.log(`  ${String(profil.identifieesParCode).padStart(7)}  ${pourcent(profil.identifieesParCode, profil.total).padStart(5)}  identifiées par un CODE agent`)
console.log(`  ${String(profil.identifieesParNumero).padStart(7)}  ${pourcent(profil.identifieesParNumero, profil.total).padStart(5)}  identifiées par un NUMÉRO agent (faute de code)`)
console.log(`  ${String(profil.sansIdentite).padStart(7)}  ${pourcent(profil.sansIdentite, profil.total).padStart(5)}  sans aucune identité agent lisible`)
if (profil.orangeIgnore > 0) {
  console.log('')
  console.log(`  ⚠ ${nombre(profil.orangeIgnore)} fiche(s) portent dans \`orange\` une valeur que l'application NE LIT PAS :`)
  console.log('    leurs champs codeAgent/numeroAgent existent mais sont vides, ce que')
  console.log("    l'écran interprète comme « vidé exprès ». La valeur dort en base.")
}

const collisions = collisionsCodeNumero(fiches)
if (collisions.valeurs.length > 0) {
  console.log('')
  console.log(`  ⚠ ${nombre(collisions.valeurs.length)} suite(s) de chiffres existent à la fois comme CODE et comme NUMÉRO,`)
  console.log(`    sur ${nombre(collisions.fichesConcernees)} fiche(s). Comparer un code à un code les sépare —`)
  console.log('    si ce sont les mêmes commerces mal rangés, ces doublons-là échappent.')
}

titre('3. POURQUOI LA COLONNE « NUMÉRO AGENT » EST VIDE')
console.log('La séparation code/numéro se fait À LA LECTURE, par la longueur :')
console.log('huit chiffres vont au NUMÉRO agent, toute autre longueur au CODE agent.')
console.log('')
console.log("Longueurs trouvées dans l'ancien champ `orange` :")
if (profil.longueursOrange.length === 0) {
  console.log('  (aucune valeur héritée)')
} else {
  for (const [longueur, n] of profil.longueursOrange) {
    const destination = longueur === 8 ? '→ numéro agent' : '→ code agent'
    console.log(`  ${String(n).padStart(7)} valeur(s) de ${longueur} chiffre(s)  ${destination}`)
  }
}
console.log('')
console.log('Longueurs trouvées dans `codeAgent` (fiches déjà rangées) :')
if (profil.longueursCode.length === 0) {
  console.log('  (aucune)')
} else {
  for (const [longueur, n] of profil.longueursCode) {
    console.log(`  ${String(n).padStart(7)} valeur(s) de ${longueur} chiffre(s)`)
  }
}
console.log('')
console.log('LECTURE : si rien ne fait huit chiffres, le numéro agent n\'a jamais été')
console.log('collecté — aucune donnée perdue, il faudra le SAISIR. Si beaucoup font huit')
console.log('chiffres et atterrissent quand même dans le code, c\'est la règle de tri')
console.log('qu\'il faut revoir, et rien n\'est à ressaisir.')

// ⚠ LA LONGUEUR SEULE NE DIT PAS CE QU'EST UNE VALEUR.
//
//   Quinze mille valeurs à sept chiffres se lisent de deux façons opposées : un
//   format de code agent, ou des téléphones amputés d'un chiffre. Le premier cas
//   veut dire « il faut saisir les numéros » ; le second, « il faut réparer une
//   saisie ». Les préfixes tranchent : une plage d'attribution se concentre sur
//   quelques têtes, une troncature de téléphones reste dispersée.
console.log('')
// ⚠ CE COMPTAGE DÉCRIT, IL NE CONCLUT PAS — et c'est une correction.
//   La première version annonçait « concentré = un code, dispersé = des
//   téléphones tronqués ». C'est faux dans un sens : un identifiant attribué au
//   hasard est uniformément distribué PAR CONSTRUCTION, donc la dispersion ne
//   prouve rien contre l'hypothèse « code ». Ce qu'elle exclut, en revanche,
//   c'est le téléphone : les mobiles d'un pays se concentrent sur quelques
//   préfixes. La comparaison aux vrais téléphones, juste en dessous, tranche.
console.log('Têtes de série (2 premiers chiffres) des valeurs les plus nombreuses :')
const parLongueur = new Map()
for (const fiche of fiches) {
  const valeur = chiffres(fiche?.orange)
  if (!valeur) continue
  if (!parLongueur.has(valeur.length)) parLongueur.set(valeur.length, new Map())
  const tetes = parLongueur.get(valeur.length)
  const tete = valeur.slice(0, 2)
  tetes.set(tete, (tetes.get(tete) || 0) + 1)
}
for (const longueur of [7, 8]) {
  const tetes = parLongueur.get(longueur)
  if (!tetes) continue
  const total = [...tetes.values()].reduce((a, b) => a + b, 0)
  const top = [...tetes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const part = top.reduce((n, [, c]) => n + c, 0)
  console.log(`  ${longueur} chiffres — ${nombre(tetes.size)} tête(s) distincte(s) ; les 6 premières couvrent ${pourcent(part, total)}`)
  console.log(`      ${top.map(([t, c]) => `${t}xxxxx:${nombre(c)}`).join('  ')}`)
}
// ⚠ ET LA VRAIE QUESTION : CES HUIT CHIFFRES SONT-ILS DES TÉLÉPHONES ?
//
//   La base répond seule, sans rien supposer sur les plages de numérotation du
//   pays : elle porte des milliers de VRAIS téléphones dans `numeroPersonnel`.
//   Si les valeurs à huit chiffres classées « numéro agent » commencent comme
//   eux, ce sont des téléphones. Si leurs têtes n'apparaissent jamais chez les
//   vrais téléphones, ce sont des codes agent rangés dans la mauvaise colonne —
//   et l'écran affiche « N° » sur ce qui est un code.
const ressemblance = comparerAuxTelephones(fiches)
console.log('')
console.log('Les valeurs classées « numéro agent » ressemblent-elles aux vrais téléphones ?')
if (ressemblance.total === 0) {
  console.log('  (aucune valeur classée numéro agent)')
} else {
  console.log(`  ${nombre(ressemblance.tetesDeTelephone)} tête(s) différentes chez les ${nombre(profil.remplissage.numeroPersonnel)} téléphones personnels.`)
  console.log(`  ${nombre(ressemblance.surTeteInconnue)} des ${nombre(ressemblance.total)} valeurs « numéro agent » (${pourcent(ressemblance.surTeteInconnue, ressemblance.total)})`)
  console.log('  commencent par une tête QU\'AUCUN téléphone de la base n\'utilise.')
  if (ressemblance.tetesInconnues.length > 0) {
    console.log(`      ${ressemblance.tetesInconnues.slice(0, 8).map(([t, n]) => `${t}xxxxxx:${nombre(n)}`).join('  ')}`)
  }
  // ⚠ LA CONCLUSION DOIT REGARDER LE CHIFFRE QU'ELLE VIENT D'IMPRIMER.
  //
  //   La version précédente énonçait toujours « une part élevée = ce ne sont pas
  //   des téléphones ». Elle laissait au lecteur le soin de décider si 4 % est
  //   une part élevée — et un rapport qui pose la question puis récite les deux
  //   réponses possibles n'a pas répondu. Pire, celle des deux qu'il imprimait
  //   était l'alarmante : à 4 %, il suggérait de revoir la règle de tri alors
  //   que la donnée dit l'inverse.
  //
  //   Le seuil est à 25 % et il est arbitraire — mais un seuil arbitraire ÉCRIT
  //   se discute, alors qu'un lecteur laissé seul devant un pourcentage conclut
  //   ce qu'il veut. Les deux diagnostics appellent des actions opposées
  //   (ressaisir des numéros / corriger le code) : il faut en nommer une.
  const SEUIL_TETES_INCONNUES = 25
  const part = (ressemblance.surTeteInconnue / ressemblance.total) * 100
  console.log('')
  if (part >= SEUIL_TETES_INCONNUES) {
    console.log(`  → LECTURE : ${pourcent(ressemblance.surTeteInconnue, ressemblance.total)} est une part ÉLEVÉE.`)
    console.log('    Ce ne sont pas des téléphones mais des CODES de huit chiffres, mal rangés')
    console.log('    par la règle de tri. Rien à ressaisir : c\'est la règle qu\'il faut revoir.')
  } else {
    console.log(`  → LECTURE : ${pourcent(ressemblance.surTeteInconnue, ressemblance.total)} est une part FAIBLE.`)
    console.log('    Ces valeurs commencent comme les vrais téléphones de la base : ce SONT')
    console.log('    des téléphones. La règle de tri est juste, et le numéro agent n\'a tout')
    console.log('    simplement jamais été collecté — il faudra le SAISIR, rien n\'est perdu.')
  }
}

// ── Les opérations, pour savoir quelle fiche compte ─────────────────────────
titre('4. CE QUI RÉFÉRENCE UNE FICHE')
const storeIds = boutiqueVoulue
  ? [boutiqueVoulue]
  : [...new Set(fiches.map((f) => f.registeredStoreId).filter(Boolean))]

const transactions = []
for (const storeId of storeIds) {
  for (const collection of ['history', 'drafts']) {
    const lot = await db.collection(`clients/${storeId}/${collection}`).get()
    for (const doc of lot.docs) transactions.push(doc.data())
  }
  console.log(`  ${storeId} : lu`)
}
console.log(`  ${nombre(transactions.length)} opération(s) dans history + drafts`)

// ⚠ UNE FICHE PEUT ÊTRE RÉFÉRENCÉE AILLEURS QUE DANS SES OPÉRATIONS.
//
//   `storeCollaborations` est une collection RACINE qui porte un `clientId` :
//   une demande entre boutiques désigne un client sans rien écrire dans
//   `history`. La première version de ce script l'ignorait, et annonçait donc
//   « sans aucune opération » pour des fiches qu'une demande en cours
//   référençait. Appelé « sans opération », ce verdict devenait « supprimable »
//   au script de fusion — et la demande aurait pointé dans le vide.
//
//   Si une autre collection racine vient à porter un clientId, elle s'ajoute
//   ICI, avant que la fusion ne s'appuie sur ces comptes.
const collabs = await db.collection('storeCollaborations').get()
const collabsNotres = collabs.docs
  .map((d) => d.data())
  .filter((c) => !boutiqueVoulue
    || c.requestingStoreId === boutiqueVoulue || c.supplierStoreId === boutiqueVoulue)
console.log(`  ${nombre(collabsNotres.length)} collaboration(s) entre boutiques`)

const operations = compterOperations(transactions)
const references = compterOperations([...transactions, ...collabsNotres])
console.log(`  → ${nombre(references.size)} fiche(s) distincte(s) référencée(s) au total`)

const fichesLibres = fiches.filter((f) => !references.has(f.id)).length
console.log(`  ${nombre(fichesLibres)} fiche(s) ne sont référencées NULLE PART (${pourcent(fichesLibres, profil.total)})`)
const seulementCollab = [...references.keys()].filter((id) => !operations.has(id)).length
if (seulementCollab > 0) {
  console.log(`  ⚠ dont ${nombre(seulementCollab)} fiche(s) référencées SEULEMENT par une collaboration`)
  console.log('    — invisibles pour qui ne lit que history et drafts.')
}

// ── Les numéros qui n'identifient personne ──────────────────────────────────
titre('4 bis. LES NUMÉROS DE REMPLISSAGE')
const poubelles = numerosSurRepresentes(fiches)
console.log('Un numéro porté par beaucoup de fiches AUX NOMS DIFFÉRENTS n\'est pas le')
console.log('téléphone d\'une personne : c\'est une valeur saisie par défaut. Le retenir')
console.log('comme identité ferait fusionner des commerces distincts.')
console.log('')
if (poubelles.suspects.length === 0) {
  console.log('  Aucun. La règle « même numéro » peut servir telle quelle.')
} else {
  console.log(`  ${nombre(poubelles.suspects.length)} numéro(s) écarté(s), portant ${nombre(poubelles.fichesConcernees)} fiche(s) :`)
  for (const s of poubelles.suspects.slice(0, 10)) {
    console.log(`    ${s.numero} — ${nombre(s.fiches)} fiche(s), ${nombre(s.nomsDistincts)} nom(s) distinct(s)`)
  }
  if (poubelles.suspects.length > 10) {
    console.log(`    … et ${nombre(poubelles.suspects.length - 10)} autre(s).`)
  }
  console.log('')
  console.log('  Les règles « téléphone » ci-dessous les EXCLUENT déjà.')
}

// ── Les quatre lectures de « doublon » ──────────────────────────────────────
const analyses = analyserDoublons(fiches, { numerosExclus: poubelles.exclus })

titre('5. LES QUATRE LECTURES DE « DOUBLON »')
console.log('« En trop » = fiches qui disparaîtraient si chaque grappe se réduisait à une.')
console.log("C'est CE chiffre qui se compare à l'écart entre le compte réel et le logiciel.")

for (const analyse of analyses) {
  const classement = classerGrappes(analyse.grappes, references)
  const tri = fusionsFranches(analyse.grappes, references)
  console.log('')
  console.log(`  ▸ ${analyse.titre}`)
  console.log(`    ${analyse.pourquoi}`)
  console.log(`    ${nombre(analyse.nombreGrappes)} grappe(s) · ${nombre(analyse.fichesConcernees)} fiche(s) concernée(s) · EN TROP : ${nombre(analyse.enTrop)}`)
  console.log(`    dont ${nombre(classement.sansOperation)} grappe(s) sans aucune référence`)
  console.log(`         ${nombre(classement.uneSeulePortante)} grappe(s) où une seule fiche sert`)
  console.log(`         ${nombre(classement.plusieursPortantes)} grappe(s) où plusieurs servent     → ⚠ REPOINTAGE`)
  console.log(`    SANS RISQUE : ${nombre(tri.franches.length)} grappe(s) → ${nombre(tri.fichesSupprimables)} fiche(s) supprimable(s)`)
  console.log(`    À REGARDER  : ${nombre(tri.aRegarder.length)} grappe(s)`)
  for (const [raison, n] of grouperRaisons(tri.aRegarder)) {
    console.log(`         ${String(n).padStart(5)}  ${raison}`)
  }

  const annotations = annotationsObservees(analyse.grappes, { maximum: 8 })
  if (annotations.length > 0) {
    console.log(`    Mots qui apparaissent dans certains noms de la grappe et pas tous :`)
    console.log(`      ${annotations.map((a) => `${a.mot} (${a.grappes})`).join('  ')}`)
  }

  const exemples = analyse.grappes.slice(0, 3)
  for (const grappe of exemples) {
    const apercu = grappe.membres
      .map((m) => `${m.nom || '?'} ${m.prenom || '?'} (${references.get(m.id) || 0} réf.)`)
      .slice(0, 4)
      .join(' · ')
    console.log(`      ex. ${grappe.membres.length} fiches — ${apercu}`)
  }
}

// ── Ce qui se supprime sans discussion ──────────────────────────────────────
titre('6. CE QUI SE SUPPRIME SANS DISCUSSION')
const sure = analyses.find((a) => a.regle === 'nom-telephone')
const triSur = fusionsFranches(sure.grappes, references)
console.log('Règle retenue : mêmes nom, prénom ET téléphone — celle qui ne fusionne')
console.log('pas les homonymes. Puis, dans ces grappes, on ne garde que celles où :')
console.log('  · toutes les fiches ont le MÊME identifiant agent, ou aucune n\'en a ;')
console.log('  · tous les noms portent exactement les mêmes mots (aucune annotation à perdre) ;')
console.log('  · au plus UNE fiche est référencée (aucune transaction à repointer).')
console.log('')
console.log(`  ${nombre(triSur.franches.length)} grappe(s) remplissent les trois conditions.`)
console.log(`  ${nombre(triSur.fichesSupprimables)} fiche(s) disparaîtraient, sans perte d'information.`)
console.log(`  ${nombre(triSur.aRegarder.length)} grappe(s) demandent un œil humain :`)
for (const [raison, n] of grouperRaisons(triSur.aRegarder)) {
  console.log(`      ${String(n).padStart(5)}  ${raison}`)
}

// ── La question de fond : l'écart est-il vraiment fait de doublons ? ─────────
titre('7. LES HOMONYMES SONT-ILS DES DOUBLONS ?')
const parNom = analyses.find((a) => a.regle === 'nom')
const croisement = croiserAvecAgent(parNom.grappes)
// ⚠ « UNIQUE » SE COMPTE PARMI LES FICHES QUI EN ONT UN. Retirer les grappes du
//   total global compterait aussi les fiches SANS identité agent comme porteuses
//   d'un identifiant unique — et l'argument de cette section s'effondrerait :
//   une fiche sans identifiant ne réfute aucun doublon, elle ne dit rien.
const identifiees = profil.identifieesParCode + profil.identifieesParNumero
const agentsUniques = identifiees - analyses.find((a) => a.regle === 'agent').fichesConcernees
console.log(`${nombre(agentsUniques)} fiche(s) sur les ${nombre(identifiees)} identifiées portent un identifiant`)
console.log("agent QUI N'APPARTIENT QU'À ELLES.")
console.log('Or un identifiant agent désigne un commerce. Deux fiches de même nom aux')
console.log('identifiants différents sont donc deux commerces, tenus par deux homonymes.')
console.log('')
console.log(`Sur les ${nombre(parNom.nombreGrappes)} grappe(s) de même nom :`)
console.log(`  ${String(croisement.unSeulAgent).padStart(7)}  un seul identifiant agent   → DOUBLON confirmé (${nombre(croisement.fichesSiUnSeulAgent)} fiche(s) en trop)`)
console.log(`  ${String(croisement.agentsTousDistincts).padStart(7)}  des identifiants tous différents → des commerces DISTINCTS, à garder`)
console.log(`  ${String(croisement.melange).padStart(7)}  un mélange des deux          → à regarder une par une`)
console.log('')
console.log('LECTURE : si la deuxième ligne domine, l\'écart entre le compte de la')
console.log('boutique et celui du logiciel n\'est PAS fait de doublons — il faut le')
console.log('chercher ailleurs (commerces fermés jamais retirés, périmètre du comptage).')

// ── Le détail, pour juger sur pièces ────────────────────────────────────────
if (fichierCsv) {
  const lignes = ['regle;cle;verdict;survivante;clientId;nom;prenom;numeroPersonnel;codeAgent;numeroAgent;orange;boutique;operations;references']
  const csv = (v) => String(v ?? '').replace(/[;\r\n]/g, ' ')
  for (const analyse of analyses) {
    // Le verdict voyage AVEC la ligne. Sans lui, le fichier dit seulement « ces
    // fiches se ressemblent » — et c'est à la main que la boutique devrait
    // refaire le tri que ce script vient de faire.
    const tri = fusionsFranches(analyse.grappes, references)
    const verdicts = new Map()
    for (const f of tri.franches) verdicts.set(f.grappe.cle, { verdict: 'sans risque', survivante: f.survivante.id })
    for (const r of tri.aRegarder) verdicts.set(r.grappe.cle, { verdict: r.raison, survivante: '' })

    for (const grappe of analyse.grappes) {
      const v = verdicts.get(grappe.cle) ?? { verdict: '', survivante: '' }
      for (const m of grappe.membres) {
        lignes.push([
          analyse.regle, grappe.cle, csv(v.verdict), m.id === v.survivante ? 'GARDER' : '',
          m.id, csv(m.nom), csv(m.prenom), csv(m.numeroPersonnel),
          csv(m.codeAgent), csv(m.numeroAgent), csv(m.orange),
          csv(m.registeredStoreName || m.registeredStoreId),
          operations.get(m.id) || 0, references.get(m.id) || 0,
        ].join(';'))
      }
    }
  }
  // BOM : sans lui, Excel ouvre les accents en charabia.
  await writeFile(fichierCsv, '﻿' + lignes.join('\r\n'), 'utf8')
  console.log('')
  console.log(`Détail écrit dans ${fichierCsv} (${nombre(lignes.length - 1)} ligne(s)).`)
}

titre('CE QUE CE SCRIPT N\'A PAS FAIT')
console.log('Aucune écriture. Aucune fiche supprimée, fusionnée ni modifiée.')
console.log('La règle à retenir se choisit au vu des chiffres ci-dessus — et la fusion')
console.log('sera un second script, avec sauvegarde vérifiée et repointage des opérations.')
