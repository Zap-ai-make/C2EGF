import { mapPaymentMethodToNetwork } from './financialImpact.js'

/**
 * detailReglement.js — ce qu'une ligne d'historique a VRAIMENT reçu, moyen par
 * moyen. Lu par le tableau de l'historique et par son export.
 *
 * Module à part, et pas dans reglement.js : l'export (helpers.js) en a besoin,
 * et reglement.js importe déjà helpers.js — la boucle aurait fait dépendre
 * l'ordre de chargement du hasard des imports.
 */

/** Les moyens que le serveur sait rattacher à un réseau (`mapPaymentMethodToNetwork`). */
const MOYENS_CONNUS = Object.freeze(['Orange Money', 'Moov Money', 'Sank Money', 'Coris Money', 'Telecel Money', 'Cash'])

/** Le moyen d'un réseau du résumé de règlement : `Liquidite` → Cash, `Orange` → Orange Money. */
export const moyenDuReseau = (reseau) => MOYENS_CONNUS.find((m) => mapPaymentMethodToNetwork(m) === reseau) ?? reseau

const codesDeLaLigne = (transaction) => {
  const resume = transaction?.settlementSummary?.agentCodes
  if (Array.isArray(resume)) return resume.filter(Boolean)
  return String(transaction?.settlementAgentCode ?? '').split(' + ').map((c) => c.trim()).filter(Boolean)
}

/**
 * Le règlement d'une ligne d'historique, MOYEN PAR MOYEN — ou `null` s'il n'en
 * a employé qu'un, ce que le statut dit déjà.
 *
 * Un retrait payé 50 000 en Orange Money sur un code, puis 50 000 en Cash, se
 * lisait « Payé par Cash → 7777777 » : un seul moyen, le dernier, et un code
 * collé à lui (31 octobre 2026). Le serveur garde pourtant le net de chaque
 * réseau (`settlementSummary.netByNetwork`, payé moins remboursé) : c'est lui
 * qu'on détaille.
 *
 * LE CODE VA AU MOYEN QUI L'A REÇU. Depuis ce lot, le serveur les range par
 * réseau (`agentCodesByNetwork`). Avant, il ne gardait que la liste : on la
 * rend alors au SEUL moyen électronique s'il n'y en a qu'un — un code agent
 * veut dire « envoyé sur un compte », pas « remis en espèces ». Sinon, les
 * codes restent dits à part, sans moyen inventé.
 *
 * @returns {{tranches: Array<{moyen: string, montant: number, codes: string[]}>, codesSansMoyen: string[]} | null}
 */
export function detailDuReglement(transaction) {
  const resume = transaction?.settlementSummary
  const parReseau = resume?.netByNetwork
  if (!parReseau || typeof parReseau !== 'object') return null

  const lignes = Object.entries(parReseau)
    .map(([reseau, net]) => ({ reseau, montant: (Number(net?.paid) || 0) - (Number(net?.refunded) || 0) }))
    .filter((ligne) => ligne.montant > 0)
  if (lignes.length < 2) return null

  const codesDe = {}
  let codesSansMoyen = []
  if (resume.agentCodesByNetwork && typeof resume.agentCodesByNetwork === 'object') {
    for (const { reseau } of lignes) {
      const codes = resume.agentCodesByNetwork[reseau]
      codesDe[reseau] = Array.isArray(codes) ? codes.filter(Boolean) : []
    }
  } else {
    const codes = codesDeLaLigne(transaction)
    const electroniques = lignes.filter(({ reseau }) => reseau !== 'Liquidite')
    if (codes.length && electroniques.length === 1) codesDe[electroniques[0].reseau] = codes
    else codesSansMoyen = codes
  }

  return {
    tranches: lignes.map(({ reseau, montant }) => ({ moyen: moyenDuReseau(reseau), montant, codes: codesDe[reseau] ?? [] })),
    codesSansMoyen,
  }
}

/**
 * Le statut, avec TOUS les moyens : « Payé par Orange Money et Cash ». Le
 * serveur n'écrit que celui de la dernière tranche ; on ne réécrit pas ce qui
 * est stocké (filtres, exports et rapports le lisent), on le dit juste à
 * l'écran.
 */
export function statutDuReglement(statut, detail) {
  const texte = String(statut ?? '')
  const coupure = texte.indexOf(' par ')
  if (!detail || coupure < 0) return texte
  const moyens = detail.tranches.map((t) => t.moyen)
  const liste = moyens.length > 1 ? `${moyens.slice(0, -1).join(', ')} et ${moyens.at(-1)}` : moyens[0]
  return `${texte.slice(0, coupure)} par ${liste}`
}
