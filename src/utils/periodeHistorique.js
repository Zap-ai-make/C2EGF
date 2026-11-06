/**
 * La période d'historique qu'on accepte de relire au serveur (lot G1).
 *
 * À l'ouverture, l'historique ne contient que la journée en cours
 * (docs/rester-dans-le-quota-gratuit.md §G). Les jours précédents ne se lisent
 * qu'à la demande, quand on choisit des dates. Ce module décide de ce que cette
 * demande coûte, et refuse ce qui coûterait trop.
 *
 * Les dates sont des clés de jour métier `AAAA-MM-JJ`, celles que rendent les
 * champs `<input type="date">`.
 */

import { addCalendarDays, businessDateKey, getBusinessDayBounds } from './businessDate.js'

/** Au-delà, une seule recherche pourrait consommer le quota d'une journée. */
export const PERIODE_MAX_JOURS = 31

const CLE_JOUR = /^\d{4}-\d{2}-\d{2}$/

const joursEntre = (de, a) => Math.round(
  (getBusinessDayBounds(a).start.getTime() - getBusinessDayBounds(de).start.getTime()) / 86_400_000,
) + 1

/**
 * Normalise ce que l'utilisateur a choisi, ou dit pourquoi on refuse.
 *
 * Le filtre gardait déjà ce sens, et TC-116 le fixe : « Du » seul veut dire « à
 * partir de », « Au » seul « jusqu'à ». Ce sens est conservé, mais borné, parce
 * que chaque jour relu se paie :
 * - « Du » seul : les PERIODE_MAX_JOURS jours qui suivent, sans dépasser
 *   aujourd'hui ;
 * - « Au » seul : les PERIODE_MAX_JOURS jours qui précèdent, ce jour compris ;
 * - les deux dates à l'envers sont remises dans l'ordre ;
 * - plus de PERIODE_MAX_JOURS jours entre les deux : refusé.
 *
 * @returns {{ from: string, to: string } | { erreur: string }}
 */
export function bornerPeriode({ from = '', to = '' } = {}, maintenant = new Date()) {
  if (!CLE_JOUR.test(from) && !CLE_JOUR.test(to)) return { erreur: 'Choisissez une date.' }
  if ((from && !CLE_JOUR.test(from)) || (to && !CLE_JOUR.test(to))) return { erreur: 'Date invalide.' }

  if (!to) {
    const aujourdhui = businessDateKey(maintenant)
    const finFenetre = addCalendarDays(from, PERIODE_MAX_JOURS - 1)
    const fin = from > aujourdhui ? from : (finFenetre < aujourdhui ? finFenetre : aujourdhui)
    return { from, to: fin }
  }
  if (!from) return { from: addCalendarDays(to, 1 - PERIODE_MAX_JOURS), to }

  const [premier, dernier] = from <= to ? [from, to] : [to, from]
  if (joursEntre(premier, dernier) > PERIODE_MAX_JOURS) {
    return { erreur: `Choisissez une période de ${PERIODE_MAX_JOURS} jours au plus.` }
  }
  return { from: premier, to: dernier }
}

/**
 * Les bornes `createdAt` à demander au serveur pour une période normalisée.
 *
 * ⚠ LA JOURNÉE EN COURS N'EST JAMAIS RELUE. Son écoute la tient déjà à jour :
 *   la relire par `getDocs` paierait chaque ligne du jour une seconde fois.
 *   La fin est donc ramenée au début d'aujourd'hui.
 *
 * @returns {{ start: Date, endExclusive: Date } | null} `null` quand il n'y a
 *   rien à lire : la période est aujourd'hui, ou dans le futur.
 */
export function bornesServeur({ from, to }, maintenant = new Date()) {
  const debutDuJour = getBusinessDayBounds(businessDateKey(maintenant)).start
  const start = getBusinessDayBounds(from).start
  const finDemandee = getBusinessDayBounds(to).end
  const endExclusive = finDemandee < debutDuJour ? finDemandee : debutDuJour
  return start < endExclusive ? { start, endExclusive } : null
}
