/**
 * La position nette par boutique partenaire — ce que le fléau met en dessin.
 *
 * POURQUOI CETTE FONCTION EXISTE
 * ──────────────────────────────
 * Firestore rend deux listes séparées : les dettes où je suis débitrice, les
 * créances où je suis créancière. Deux listes ne répondent pas à la question du
 * gérant, qui est bilatérale : « avec Gounghin, où j'en suis ? ». Ce module est
 * la seule couche qui croise les deux, et c'est là que vivent les décisions qui
 * se paient cher si on les prend au fil de l'eau.
 *
 * QUATRE DÉCISIONS, ET LEURS RAISONS
 * ──────────────────────────────────
 * 1. SEUL LE RESTE DÛ COMPTE. `remainingAmount`, jamais `originalAmount` : une
 *    dette de 180 000 déjà réglée à moitié pèse 90 000 sur la position, pas
 *    180 000.
 *
 * 2. UNE BOUTIQUE ENTIÈREMENT SOLDÉE DISPARAÎT. Elle appartient à l'historique,
 *    pas à l'écran des positions ouvertes — sinon la liste ne fait que grandir
 *    et la question « où suis-je exposée » se noie dans les zéros.
 *    ⚠ Le critère porte sur les BRAS (`debt > 0 || credit > 0`), jamais sur le
 *      net : une boutique à qui je dois 45 000 et qui me doit 45 000 a un net
 *      nul mais deux dettes ouvertes — et c'est précisément le cas le plus
 *      actionnable de l'écran, celui que la compensation efface d'un geste.
 *
 * 3. L'ÉCHELLE SE PREND SUR LE PLUS GRAND BRAS, pas sur le plus grand net.
 *    Sinon une boutique à net nul mais à gros bras opposés déborderait de la
 *    poutre, ou n'aurait pas de bras du tout.
 *
 * 4. LE TRI SE FAIT SUR `max(|net|, compensable)`. Trier sur le seul net
 *    enverrait en bas de liste la boutique où il y a le plus à gagner d'un
 *    geste. Deux choses appellent l'attention du gérant — être exposé, et
 *    pouvoir compenser — et l'ordre doit refléter les deux.
 *
 * TOLÉRANCE AUX DONNÉES ABÎMÉES
 * ─────────────────────────────
 * Un montant illisible n'est pas compté comme zéro en silence : ce serait faire
 * disparaître de l'argent d'un écran qui sert à savoir combien on doit. Il est
 * écarté ET compté dans `ignored`, pour que la page puisse le dire.
 */

import { isValidStoredAmount } from './formatCurrency.js'

const OPEN_ENOUGH = (montant) => montant > 0

/**
 * @param {object} params
 * @param {string} params.storeId          ma boutique
 * @param {Array}  [params.debts]          documents où je suis `debtorStoreId`
 * @param {Array}  [params.credits]        documents où je suis `creditorStoreId`
 * @returns {{
 *   totalDebt: number, totalCredit: number, net: number,
 *   maxArm: number, ignored: number, partners: Array
 * }}
 */
export function computeDebtPositions({ storeId, debts = [], credits = [] } = {}) {
  const parBoutique = new Map()
  let ignored = 0

  const accumuler = (docs, sens) => {
    for (const doc of docs ?? []) {
      const montant = doc?.remainingAmount
      if (!isValidStoredAmount(montant)) {
        ignored += 1
        continue
      }

      // Le partenaire est TOUJOURS l'autre partie. Un document où les deux
      // côtés seraient ma boutique n'a pas de partenaire : il est écarté plutôt
      // que rendu comme une dette envers moi-même.
      const partnerId = sens === 'debt' ? doc?.creditorStoreId : doc?.debtorStoreId
      const partnerName = sens === 'debt' ? doc?.creditorStoreName : doc?.debtorStoreName
      if (!partnerId || partnerId === storeId) {
        ignored += 1
        continue
      }

      if (!parBoutique.has(partnerId)) {
        parBoutique.set(partnerId, {
          storeId: partnerId,
          name: null,
          debt: 0,
          credit: 0,
          debts: [],
          credits: [],
        })
      }
      const p = parBoutique.get(partnerId)
      // Le premier nom non nul l'emporte. Les documents arrivent du plus récent
      // au plus ancien : c'est donc le nom le plus récemment enregistré.
      if (p.name == null && partnerName) p.name = partnerName

      if (sens === 'debt') {
        p.debt += montant
        p.debts.push(doc)
      } else {
        p.credit += montant
        p.credits.push(doc)
      }
    }
  }

  accumuler(debts, 'debt')
  accumuler(credits, 'credit')

  const partners = [...parBoutique.values()]
    .filter((p) => OPEN_ENOUGH(p.debt) || OPEN_ENOUGH(p.credit))
    .map((p) => ({
      ...p,
      name: p.name ?? p.storeId,
      net: p.credit - p.debt,
      // Ce que la compensation peut effacer des deux côtés à la fois.
      compensable: Math.min(p.debt, p.credit),
    }))
    .sort((a, b) => {
      const poids = (p) => Math.max(Math.abs(p.net), p.compensable)
      return poids(b) - poids(a) || a.name.localeCompare(b.name, 'fr')
    })

  const totalDebt = partners.reduce((somme, p) => somme + p.debt, 0)
  const totalCredit = partners.reduce((somme, p) => somme + p.credit, 0)
  const maxArm = partners.reduce((max, p) => Math.max(max, p.debt, p.credit), 0)

  return {
    totalDebt,
    totalCredit,
    net: totalCredit - totalDebt,
    maxArm,
    ignored,
    partners,
  }
}

/**
 * La demi-largeur d'un bras, en pourcentage de la piste.
 *
 * La piste vaut 100 %, la ligne de zéro est au milieu : un bras ne peut donc
 * jamais dépasser 50 %. Le plafond n'est pas une précaution défensive, c'est la
 * définition — sans lui, un `maxArm` mal calculé ferait sortir la barre de sa
 * ligne et le dessin mentirait sur la comparaison qu'il propose.
 */
export function armWidthPercent(amount, maxArm) {
  if (!isValidStoredAmount(amount) || !(maxArm > 0)) return 0
  return Math.min(50, (amount / maxArm) * 50)
}
