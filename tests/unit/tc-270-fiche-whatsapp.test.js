import { describe, it, expect } from 'vitest'
import { texteFiche, lienWhatsApp } from '../../src/utils/ficheWhatsApp.js'

/**
 * TC-270 — la fiche qui part sur WhatsApp.
 *
 * ⚠ CE BOUTON FAIT SORTIR LA FICHE DU CRM. C'est demandé et volontaire, mais à
 *   partir de ce geste la donnée vit dans une conversation que l'application ne
 *   contrôle plus — et personne ne peut la corriger après coup. D'où trois
 *   règles tenues ici : le texte ne porte QUE ce que le patron a déjà sous les
 *   yeux, il n'affirme jamais plus que l'écran, et il ne porte aucun
 *   identifiant technique.
 */

const client = {
  id: 'ZZQ-ID-7788', nom: 'OUEDRAOGO', prenom: 'Salif', codeAgent: '6412887',
  numeroAgent: '70112233', localite: 'Ouaga secteur 15', registeredStoreName: 'FADA',
}
const delai = { jours: 9, mesurees: 6, total: 24 }

describe('TC-270 — ce que le texte contient', () => {
  it('[TC-270-01] le nom, le code agent et la boutique', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toContain('OUEDRAOGO Salif')
    expect(t).toContain('6412887')
    expect(t).toContain('FADA')
  })

  it('[TC-270-02] le délai et son effectif, jamais le délai seul', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toMatch(/9 j/)
    expect(t).toMatch(/6 .*24/)
  })

  /**
   * ⚠ `mesurees` COMPTE DES DÉPÔTS, PAS DES OPÉRATIONS (tâche 5, I-2). Le texte
   *   doit nommer ce qu'il a mesuré, sinon il annonce un délai de remboursement
   *   calculé sur un effectif que le lecteur croit être l'activité entière.
   */
  it('[TC-270-03] il dit que la mesure porte sur des dépôts', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toMatch(/dépôts? mesurés?/i)
  })

  /**
   * ⚠ LA RÉSERVE VOYAGE AVEC LE CHIFFRE. Celui qui reçoit le message ne peut pas
   *   cliquer « Charger plus » pour voir le chiffre se préciser.
   */
  it('[TC-270-04] il dit que le calcul ne porte que sur les opérations chargées', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).toMatch(/chargées/i)
  })

  /**
   * ⚠ « JAMAIS MESURÉ » NE VEUT PAS DIRE « IL N'A JAMAIS FAIT ATTENDRE ».
   *   Après I-2, `jours === null` signifie « aucun DÉPÔT mesurable » : un agent
   *   avec vingt retraits impayés tomberait dans cette branche. Le message ne
   *   doit donc rien affirmer sur ses retraits.
   */
  it('[TC-270-05] sans mesure, il ne dit pas « 0 j » et ne blanchit pas le client', () => {
    const t = texteFiche({ client, lignes: [], delai: { jours: null, mesurees: 0, total: 3 } })
    expect(t).not.toMatch(/\b0 j\b/)
    expect(t).toMatch(/jamais mesuré/i)
    expect(t).toMatch(/aucun dépôt mesurable/i)
    expect(t).not.toMatch(/aucune de ses opérations/i)
  })

  it('[TC-270-06] sans aucune opération chargée, il ne parle pas de dépôts manquants', () => {
    const t = texteFiche({ client, lignes: [], delai: { jours: null, mesurees: 0, total: 0 } })
    expect(t).toMatch(/aucune opération chargée/i)
  })

  /**
   * ⚠ MÊME DÉFAUT QUE M-1 À L'ÉCRAN, MAIS DANS UN MESSAGE QU'ON NE RATTRAPE PAS.
   *   `delaiMoyen` arrondit au jour : un agent réglant en 3 h donne `jours: 0`.
   */
  it('[TC-270-07] une moyenne sous un jour ne s\'écrit pas « 0 j »', () => {
    const t = texteFiche({ client, lignes: [], delai: { jours: 0, mesurees: 2, total: 5 } })
    expect(t).not.toMatch(/\b0 j\b/)
    expect(t).toMatch(/moins d'un jour/i)
  })

  /** ⚠ Un identifiant Firestore dans un message WhatsApp ne sert personne. */
  it('[TC-270-08] aucun identifiant technique ne fuit', () => {
    const t = texteFiche({
      client,
      lignes: [{ id: 'h-abc123', date: '01/10', type: 'Depot', montant: 1000 }],
      delai,
    })
    expect(t).not.toContain('ZZQ-ID-7788')
    expect(t).not.toContain('h-abc123')
  })

  it('[TC-270-09] le texte est du texte simple, sans balise', () => {
    const t = texteFiche({ client, lignes: [], delai })
    expect(t).not.toMatch(/[<>]/)
  })

  /** ⚠ Un appel sans `delai` ne doit pas jeter : l'en-tête se rend avant tout. */
  it('[TC-270-10] un appel sans délai ni client ne jette pas', () => {
    expect(() => texteFiche({})).not.toThrow()
  })
})

describe('TC-270 — le lien', () => {
  it('[TC-270-11] il vise wa.me et encode le texte', () => {
    expect(lienWhatsApp('a b&c')).toBe('https://wa.me/?text=a%20b%26c')
  })

  /**
   * ⚠ AUCUN NUMÉRO N'EST PRÉ-REMPLI. `wa.me` sans numéro ouvre le sélecteur de
   *   contacts. Pré-remplir celui du client supposerait qu'on lui envoie
   *   toujours sa propre fiche — alors qu'on la montre souvent à un gérant.
   */
  it('[TC-270-12] il ne porte aucun numéro de destinataire', () => {
    expect(lienWhatsApp('x')).not.toMatch(/wa\.me\/\d/)
  })
})
