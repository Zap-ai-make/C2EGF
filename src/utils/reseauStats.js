/**
 * reseauStats.js — Statistiques de pilotage d'un distributeur.
 *
 * Fonctions PURES : aucun accès Firestore, aucun état React. Elles ne lisent
 * que ce que l'application a déjà en mémoire — le portefeuille d'agents, les
 * opérations, et les soldes réseau. Aucune lecture supplémentaire, aucun champ
 * nouveau en base.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Deux règles de comptage, volontairement distinctes
 *
 *   ACTIVITÉ  « l'agent est-il venu ? » Toute opération non annulée compte,
 *             y compris celles encore en attente de règlement : l'agent s'est
 *             bien présenté. Sert à la couverture et aux décrochages.
 *
 *   VOLUME    « l'argent a-t-il bougé ? » On exclut en plus les opérations en
 *             attente, qui ne sont pas encore réglées. Sert au volume traité
 *             et à la concentration.
 *
 * Les confondre donnerait une couverture trop basse ou un volume gonflé.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { parsefrenchDate } from './helpers.js'
import { isDepositType, isWithdrawalType } from './financialImpact.js'

/**
 * Seuil de décrochage, en jours. Décidé avec C2EGF : un seuil unique, le même
 * pour tous les agents, qui se lit et s'explique en une phrase. Ce n'est que le
 * défaut proposé à l'ouverture — l'écran permet de le régler.
 */
export const SEUIL_DECROCHAGE_JOURS = 15

/** Fenêtre par défaut de la couverture réseau, en jours. */
export const FENETRE_COUVERTURE_JOURS = 7

const JOUR_MS = 24 * 60 * 60 * 1000

const sansAccent = (v) =>
  String(v || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Une opération annulée n'a jamais eu lieu, ni comme visite ni comme volume. */
export const estAnnulee = (tx) => sansAccent(tx?.statut) === 'annulee'

/** L'agent s'est présenté : toute opération non annulée en atteste. */
export const compteCommeVisite = (tx) => Boolean(tx) && !estAnnulee(tx)

/**
 * L'argent a bougé : ni annulée, ni encore en attente de règlement.
 * Les statuts de règlement (« Payé par… », « Encaissé par… ») comptent — c'est
 * précisément le moment où les soldes sont impactés.
 */
export const compteCommeVolume = (tx) =>
  compteCommeVisite(tx) && sansAccent(tx.statut) !== 'non terminees'

/**
 * Date d'une opération. Le champ `date` porte « JJ/MM/AAAA HH:mm » ; on retombe
 * sur les horodatages Firestore quand il manque, comme le fait déjà l'affichage.
 */
export function dateOperation(tx) {
  if (!tx) return null
  const brut = tx.date
  if (typeof brut === 'string' && /\d{1,2}:\d{2}/.test(brut)) {
    return parsefrenchDate(brut)
  }
  for (const champ of [tx.createdAt, tx.validatedAt, tx.updatedAt]) {
    if (champ && typeof champ.toDate === 'function') return champ.toDate()
    if (champ instanceof Date) return champ
  }
  return parsefrenchDate(brut)
}

/**
 * Clé d'agent d'une opération. `clientId` est posé à la saisie ; le code agent
 * sert de repli pour les écritures anciennes.
 */
export function cleAgent(tx) {
  return tx?.clientId || tx?.client?.id || tx?.code || null
}

const dansLaFenetre = (date, depuis) => Boolean(date) && date >= depuis

/**
 * Couverture : combien d'agents du portefeuille ont travaillé sur la fenêtre.
 *
 * Seuls les agents ENRÔLÉS comptent. Une saisie manuelle par code n'appartient
 * pas au portefeuille et gonflerait artificiellement le taux.
 */
export function calculerCouverture(clients = [], transactions = [], options = {}) {
  const { fenetreJours = FENETRE_COUVERTURE_JOURS, maintenant = new Date() } = options
  const depuis = new Date(maintenant.getTime() - fenetreJours * JOUR_MS)

  const enroles = new Set(clients.map((c) => c?.id).filter(Boolean))
  const actifs = new Set()
  let visites = 0

  for (const tx of transactions) {
    if (!compteCommeVisite(tx)) continue
    if (!dansLaFenetre(dateOperation(tx), depuis)) continue
    const cle = cleAgent(tx)
    if (!cle || !enroles.has(cle)) continue
    actifs.add(cle)
    visites++
  }

  return {
    totalAgents: enroles.size,
    actifs: actifs.size,
    part: enroles.size > 0 ? actifs.size / enroles.size : 0,
    visites,
    // La cadence réelle, mesurée. C2EGF annonce 4 à 5 passages par jour pour
    // ses gros agents : ce chiffre le confirme ou le dément.
    passagesParAgent: actifs.size > 0 ? visites / actifs.size : 0,
    fenetreJours,
  }
}

/**
 * Décrochages : agents enrôlés qui ont déjà travaillé, mais plus depuis le
 * seuil.
 *
 * Un agent jamais actif n'est PAS un décrochage : c'est un agent à activer,
 * ce qui est un autre sujet et une autre action commerciale.
 */
export function calculerDecrochages(clients = [], transactions = [], options = {}) {
  const { seuilJours = SEUIL_DECROCHAGE_JOURS, maintenant = new Date() } = options
  const limite = new Date(maintenant.getTime() - seuilJours * JOUR_MS)

  const dernierPassage = new Map()
  for (const tx of transactions) {
    if (!compteCommeVisite(tx)) continue
    const cle = cleAgent(tx)
    const date = dateOperation(tx)
    if (!cle || !date) continue
    const connu = dernierPassage.get(cle)
    if (!connu || date > connu) dernierPassage.set(cle, date)
  }

  const decroches = []
  for (const agent of clients) {
    if (!agent?.id) continue
    const dernier = dernierPassage.get(agent.id)
    if (!dernier || dernier >= limite) continue
    decroches.push({
      agent,
      dernierPassage: dernier,
      joursDeSilence: Math.floor((maintenant - dernier) / JOUR_MS),
    })
  }

  decroches.sort((a, b) => b.joursDeSilence - a.joursDeSilence)
  return { seuilJours, decroches, total: decroches.length }
}

/**
 * Concentration : quelle part du volume repose sur les plus gros agents.
 *
 * Les saisies manuelles comptent ici — elles représentent du volume réel, même
 * si le compte n'est pas au portefeuille.
 */
export function calculerConcentration(transactions = [], clients = [], options = {}) {
  const { topN = 10, fenetreJours = 30, maintenant = new Date() } = options
  const depuis = new Date(maintenant.getTime() - fenetreJours * JOUR_MS)

  const nomParCle = new Map(
    clients
      .filter((c) => c?.id)
      .map((c) => [c.id, `${c.prenom || ''} ${c.nom || ''}`.trim()]),
  )

  const volumeParAgent = new Map()
  let volumeTotal = 0

  for (const tx of transactions) {
    if (!compteCommeVolume(tx)) continue
    if (!dansLaFenetre(dateOperation(tx), depuis)) continue
    const cle = cleAgent(tx)
    if (!cle) continue
    const montant = Number(tx.montant) || 0
    volumeParAgent.set(cle, (volumeParAgent.get(cle) || 0) + montant)
    volumeTotal += montant
  }

  const classement = [...volumeParAgent.entries()]
    .map(([cle, volume]) => ({
      cle,
      volume,
      nom: nomParCle.get(cle) || 'Saisie manuelle',
    }))
    .sort((a, b) => b.volume - a.volume)

  const tete = classement.slice(0, topN)
  const volumeTete = tete.reduce((somme, a) => somme + a.volume, 0)

  return {
    topN,
    fenetreJours,
    volumeTotal,
    agentsComptes: classement.length,
    tete,
    partTete: volumeTotal > 0 ? volumeTete / volumeTotal : 0,
  }
}

/**
 * La balance : position du fonds de roulement entre stock électronique et
 * espèces, et dérive du jour.
 *
 * Avec un réseau unique, les deux sont des vases communicants EXACTS : un dépôt
 * fait stock ↓ / liquidité ↑, un retrait l'inverse (voir financialImpact.js,
 * applyInitialTransactionImpact). Leur somme — le fonds de roulement — ne bouge
 * que sur ravitaillement de la centrale.
 */
export function calculerBalance(networkData = {}, transactions = [], options = {}) {
  const { reseau = 'Orange', maintenant = new Date() } = options

  const stock = Number(networkData?.[reseau]?.stock) || 0
  const liquidite = Number(networkData?.Liquidite?.liquidite) || 0
  const fondsRoulement = stock + liquidite

  const debutDuJour = new Date(maintenant)
  debutDuJour.setHours(0, 0, 0, 0)

  let versLiquidite = 0
  let versStock = 0
  for (const tx of transactions) {
    if (!compteCommeVolume(tx)) continue
    const date = dateOperation(tx)
    if (!date || date < debutDuJour) continue
    const montant = Number(tx.montant) || 0
    if (isDepositType(tx.type)) versLiquidite += montant
    else if (isWithdrawalType(tx.type)) versStock += montant
  }

  return {
    reseau,
    stock,
    liquidite,
    fondsRoulement,
    partStock: fondsRoulement > 0 ? stock / fondsRoulement : 0,
    versLiquidite,
    versStock,
    deriveNette: versLiquidite - versStock,
  }
}

/**
 * Projection de rupture : à la cadence observée depuis ce matin, dans combien
 * de temps le vase qui se vide sera-t-il à sec ?
 *
 * C'est le chiffre qui déclenche une demande de ravitaillement À TEMPS, plutôt
 * qu'un « stock bas » qu'on découvre quand un agent est déjà au comptoir.
 *
 * Trois garde-fous, parce qu'une projection fausse est pire que pas de
 * projection :
 *
 *   - au moins `minOperations` opérations dans la journée, sinon la cadence
 *     n'est qu'un accident ;
 *   - au moins une heure écoulée, sinon on divise par presque zéro ;
 *   - on ne projette QUE le vase qui se vide. Si les dépôts dominent, c'est le
 *     stock qui fond ; si ce sont les retraits, c'est la liquidité.
 *
 * Renvoie `null` dès qu'une condition manque — l'appelant n'affiche alors rien,
 * ce qui est la bonne réponse.
 */
export function projeterRupture(balance, transactions = [], options = {}) {
  const { maintenant = new Date(), minOperations = 5 } = options
  if (!balance) return null

  const debutDuJour = new Date(maintenant)
  debutDuJour.setHours(0, 0, 0, 0)

  let operations = 0
  let premiere = null
  for (const tx of transactions) {
    if (!compteCommeVolume(tx)) continue
    const date = dateOperation(tx)
    if (!date || date < debutDuJour) continue
    operations++
    if (!premiere || date < premiere) premiere = date
  }

  if (operations < minOperations || !premiere) return null

  const heuresEcoulees = (maintenant - premiere) / (60 * 60 * 1000)
  if (heuresEcoulees < 1) return null

  const derive = balance.deriveNette
  if (derive === 0) return null

  const versLeVide = derive > 0 ? 'stock' : 'liquidite'
  const soldeRestant = versLeVide === 'stock' ? balance.stock : balance.liquidite
  const tauxParHeure = Math.abs(derive) / heuresEcoulees
  if (tauxParHeure <= 0) return null

  const heuresRestantes = soldeRestant / tauxParHeure
  const rupture = new Date(maintenant.getTime() + heuresRestantes * 60 * 60 * 1000)

  return {
    vase: versLeVide,
    soldeRestant,
    tauxParHeure,
    heuresRestantes,
    rupture,
    // Au-delà d'une journée de travail, la projection ne dit plus rien d'utile :
    // elle sera recalculée demain sur des données fraîches.
    dansLaJournee: heuresRestantes <= 12,
    operations,
  }
}

/**
 * Flux : volume par jour et par sens, sur une fenêtre glissante.
 *
 * Les retraits sont aussi renvoyés en négatif (`retraitsNegatifs`) pour un
 * graphe divergent autour de zéro. Une courbe unique additionnant les deux sens
 * masque la dérive, qui est justement l'information : savoir si la journée a
 * poussé le fonds vers les espèces ou vers le stock.
 */
export function calculerFlux(transactions = [], options = {}) {
  const { jours = 14, maintenant = new Date() } = options

  const paves = []
  const index = new Map()

  for (let i = jours - 1; i >= 0; i--) {
    const jour = new Date(maintenant.getTime() - i * JOUR_MS)
    jour.setHours(0, 0, 0, 0)
    const pave = {
      cle: jour.toDateString(),
      date: jour,
      libelle: jour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      depots: 0,
      retraits: 0,
    }
    paves.push(pave)
    index.set(pave.cle, pave)
  }

  for (const tx of transactions) {
    if (!compteCommeVolume(tx)) continue
    const date = dateOperation(tx)
    if (!date) continue
    const pave = index.get(date.toDateString())
    if (!pave) continue
    const montant = Number(tx.montant) || 0
    if (isDepositType(tx.type)) pave.depots += montant
    else if (isWithdrawalType(tx.type)) pave.retraits += montant
  }

  return paves.map((p) => ({ ...p, retraitsNegatifs: -p.retraits }))
}
