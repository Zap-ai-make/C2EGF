import { describe, it, expect } from 'vitest'
import { sommesEnAttente, totalCaisse } from '../../src/utils/caisse.js'
import { createExportData } from '../../src/utils/helpers.js'

/**
 * TC-239 — Les défauts remontés par la revue de code.
 *
 * POURQUOI UN FICHIER À PART
 * ──────────────────────────
 * Ces défauts ont survécu à toute la batterie existante. Les tests qui les
 * attrapent n'ont donc leur place dans aucun des fichiers qui les ont laissés
 * passer : les regrouper ici dit ce qu'ils sont — la trace d'une relecture, et
 * la garantie que ces quatre-là ne reviendront pas.
 *
 * Les deux défauts d'interface (le verrou du retour, le code agent résiduel)
 * sont dans TC-240, qui a besoin du DOM.
 */

const brouillon = (over = {}) => ({
  id: 'd-1',
  type: 'Dépôt',
  montant: 100_000,
  ...over,
})

describe('TC-239 — le total de caisse compte le RESTE dû', () => {
  /**
   * ⚠ LE DÉFAUT. Une transaction partiellement réglée a déjà vu ses tranches
   *   encaissées passer dans les soldes. La recompter en entier fait annoncer
   *   au bandeau un total supérieur à ce que contient la caisse, et la
   *   caissière cherche l'écart chez elle.
   */
  it('[TC-239-1] un dépôt à moitié encaissé ne compte que pour son reste', () => {
    const somme = sommesEnAttente([
      brouillon({ montant: 100_000, remainingAmount: 40_000 }),
    ])

    expect(somme.depots).toBe(40_000)
  })

  it('[TC-239-2] un retrait à moitié payé aussi', () => {
    const somme = sommesEnAttente([
      brouillon({ type: 'Retrait', montant: 80_000, remainingAmount: 30_000 }),
    ])

    expect(somme.retraits).toBe(30_000)
  })

  /** Sans règlement partiel — l'immense majorité — rien ne change. */
  it('[TC-239-3] un brouillon jamais réglé compte pour son montant', () => {
    expect(sommesEnAttente([brouillon({ montant: 100_000 })]).depots).toBe(100_000)
  })

  it('[TC-239-4] un reste dû à zéro ne compte pas pour le montant d’origine', () => {
    // `remainingAmount: 0` fait autorité : la ligne est soldée, elle n'attend
    // plus rien. Retomber sur `montant` ressusciterait 100 000 fantômes.
    expect(sommesEnAttente([brouillon({ montant: 100_000, remainingAmount: 0 })]).depots).toBe(0)
  })

  it('[TC-239-5] et le total de caisse suit', () => {
    const somme = sommesEnAttente([
      brouillon({ id: 'a', montant: 100_000, remainingAmount: 40_000 }),
      brouillon({ id: 'b', type: 'Retrait', montant: 50_000 }),
    ])
    const total = totalCaisse({ stock: 1_000_000, liquidite: 500_000, ...somme })

    // 1 000 000 + 500 000 + 40 000 − 50 000
    expect(total).toBe(1_490_000)
  })
})

describe('TC-239 — l’export client n’emporte pas les lignes du dealer', () => {
  const client = (over = {}) => ({
    type: 'Dépôt',
    client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
    code: '000111',
    montant: 50_000,
    date: '08/10/2026 10:00',
    ...over,
  })

  /**
   * ⚠ LE DÉFAUT. Un retour partage l'onglet des transactions clients — la
   *   boutique relit sa journée d'un seul tenant, et c'est voulu. Mais son
   *   montant ne répond pas à « combien les clients ont-ils déposé ? » :
   *   l'exporter gonflait le fichier remis au gérant d'une somme qu'aucune
   *   ligne client ne justifie.
   */
  it('[TC-239-6] un retour et un ravitaillement sont écartés', () => {
    const lignes = createExportData([
      client(),
      { type: 'Retour', expediteur: 'Patron', montant: 1_500_000, date: '08/10/2026 14:24' },
      { type: 'Ravitaillement', expediteur: 'Patron', montant: 3_000_000, date: '08/10/2026 08:00' },
      { type: 'Clôture', montant: 900_000, date: '08/10/2026 19:00' },
    ])

    expect(lignes).toHaveLength(1)
    expect(lignes[0].Client).toBe('Aïssata Ouedraogo')
  })

  it('[TC-239-7] la numérotation reste continue après le retrait', () => {
    const lignes = createExportData([
      client({ code: 'A' }),
      { type: 'Retour', montant: 1_500_000 },
      client({ code: 'B' }),
    ])

    expect(lignes.map((l) => l['N°'])).toEqual([1, 2])
    expect(lignes.map((l) => l.Code)).toEqual(['A', 'B'])
  })

  it('[TC-239-8] les transactions clients gardent toutes leurs colonnes', () => {
    const [ligne] = createExportData([client({ settlementAgentCode: '7654321' })])

    expect(ligne.Client).toBe('Aïssata Ouedraogo')
    expect(ligne['Montant (FCFA)']).toBe(50_000)
    expect(ligne['Code agent destinataire']).toBe('7654321')
  })
})
