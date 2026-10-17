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

  /**
   * ⚠ Un identifiant Firestore dans un message WhatsApp ne sert personne.
   *
   * ⚠ RONDE DE CORRECTION 1 (M-5) — CETTE LIGNE PREND LA FORME RÉELLE DU
   *   SERVEUR (`functions/src/clients/historiqueClient.js:150-160` :
   *   `typePlie`, `statut`), PAS UNE FORME DÉGÉNÉRÉE. C'était le seul test du
   *   fichier à monter des lignes, et il n'en asserte rien — c'est ce vide qui
   *   a laissé passer R23 (voir TC-270-14 à TC-270-17, qui asserte le bloc).
   */
  it('[TC-270-08] aucun identifiant technique ne fuit', () => {
    const t = texteFiche({
      client,
      lignes: [{
        id: 'h-abc123', date: '01/10', type: 'Depot', typePlie: 'depot',
        statut: 'Validée', montant: 1000,
      }],
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

  /**
   * ⚠ RONDE DE CORRECTION 1 (M-2) — REPLI SUR « CLIENT ». Sans ce repli, une
   *   fiche sans nom ni prénom laisse une ligne vide à la place du nom — le
   *   même défaut que `.filter(l => l !== null)` laisse passer une chaîne
   *   vide. L'écran replie déjà sur « Client » ; le message doit faire pareil.
   */
  it('[TC-270-13] un client sans nom ni prenom affiche « Client »', () => {
    const t = texteFiche({ client: { id: 'x' }, lignes: [], delai })
    expect(t).toMatch(/^Client$/m)
  })

  /**
   * ⚠ RONDE DE CORRECTION 1, C-2 (R23) — LA RÈGLE CENTRALE DU FICHIER, « NE
   *   JAMAIS AFFIRMER PLUS QUE L'ÉCRAN », S'APPLIQUE AUSSI AU BLOC DES
   *   OPÉRATIONS. `LigneHistorique.jsx` montre une ligne supprimée barrée et à
   *   opacité réduite, et une ligne annulée sous une pastille rouge — le texte
   *   simple n'a ni l'un ni l'autre, et le serveur ne filtre ni `deletedAt` ni
   *   `statut` (`listClientHistory.js`). Scénario qui a motivé ce correctif :
   *   un retrait annulé de 500 000 FCFA, et une ligne supprimée de 999 999
   *   FCFA (rouverte par `reopenHistory`) — la première doit sortir AVEC son
   *   statut, la seconde ne doit pas sortir DU TOUT.
   */
  it('[TC-270-14] une opération annulée porte son statut, une opération supprimée ne part pas', () => {
    const annulee = {
      id: 'h1', date: '14/10', type: 'Retrait', typePlie: 'retrait',
      montant: 500000, statut: 'Annulée',
    }
    const supprimee = {
      id: 'h2', date: '13/10', type: 'Depot', typePlie: 'depot',
      montant: 999999, statut: 'Validée', deletedAt: 1760000000000,
    }
    const t = texteFiche({ client, lignes: [annulee, supprimee], delai })
    const montantAnnule = (500000).toLocaleString('fr-FR')
    const montantSupprime = (999999).toLocaleString('fr-FR')
    expect(t).toContain(montantAnnule)
    expect(t).toMatch(/Annulée/)
    expect(t).not.toContain(montantSupprime)
  })

  /**
   * ⚠ RONDE DE CORRECTION 1, I-1 (R24) — LA DURÉE NOMME CELUI QU'ELLE MESURE.
   *   `dureeDe` mesure `validatedAt − createdAt`, quel que soit le sens de
   *   l'opération. Sur un retrait, c'est le temps que LA BOUTIQUE a mis à
   *   remettre l'argent — pas un retard du client. Juste sous la seule autre
   *   phrase chiffrée du message (le délai de remboursement DU CLIENT), un
   *   « (3j 00:00) » nu ferait porter au client un délai qui est parfois celui
   *   de sa propre boutique.
   */
  it('[TC-270-15] la durée d’un dépôt et celle d’un retrait ne disent pas la même chose', () => {
    const debut = new Date('2026-10-10T08:00:00Z')
    const troisJoursPlusTard = new Date(debut.getTime() + 3 * 24 * 60 * 60 * 1000)
    const depot = {
      id: 'd1', date: '10/10', type: 'Dépôt', typePlie: 'depot', montant: 20000,
      statut: 'Validée', createdAt: debut, validatedAt: troisJoursPlusTard,
    }
    const retrait = {
      id: 'r1', date: '11/10', type: 'Retrait', typePlie: 'retrait', montant: 30000,
      statut: 'Validée', createdAt: debut, validatedAt: troisJoursPlusTard,
    }

    const tDepot = texteFiche({ client, lignes: [depot], delai })
    expect(tDepot).toMatch(/réglé en 3j/)
    expect(tDepot).not.toMatch(/remis par la boutique/)

    const tRetrait = texteFiche({ client, lignes: [retrait], delai })
    expect(tRetrait).toMatch(/remis par la boutique en 3j/)
    expect(tRetrait).not.toMatch(/\bréglé en\b/)
  })

  /**
   * ⚠ RONDE DE CORRECTION 1 (M-6) — « N DES M DERNIÈRES », PAS UN TITRE NU.
   *   Le patron voit un bloc « DERNIERES OPERATIONS » suivi de quatre lignes :
   *   rien ne dit si c'est tout l'historique chargé ou les quatre plus
   *   récentes d'un historique plus long.
   */
  it('[TC-270-16] avec plus de quatre opérations, l’en-tête dit combien sont affichées sur combien', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`, date: `0${i + 1}/10`, type: 'Depot', typePlie: 'depot',
      statut: 'Validée', montant: 1000 * (i + 1),
    }))
    const t = texteFiche({ client, lignes: six, delai })
    expect(t).toMatch(/4 des 6 dernières opérations/i)
  })

  /**
   * ⚠ UNE DIRECTION INCONNUE NE S'ÉTIQUETTE PAS. `estRetrait` était écrit
   *   `typePlie !== 'depot'`, donc TOUT ce qui n'est pas un dépôt — y compris
   *   une ligne dont le `typePlie` est absent, vide ou inattendu — repartait
   *   étiqueté « remis par la boutique », c'est-à-dire en accusant la
   *   boutique d'un retard dont rien ne dit qu'il est le sien. `plierType`
   *   (`functions/src/clients/historiqueClient.js`) replie le type réel du
   *   serveur : il rend `'depot'` ou `'retrait'` sur les variantes connues,
   *   mais rend la valeur pliée telle quelle sur tout autre type.
   *
   *   C'est le même défaut que R24 corrigeait, par l'autre bout : là, une
   *   durée non étiquetée se lisait comme celle du client ; ici, une durée
   *   étiquetée à tort se lit comme celle de la boutique. La seule réponse
   *   honnête sur une direction inconnue est de ne pas publier la durée —
   *   le montant, la date et le statut, eux, restent exacts et partent.
   */
  it('[TC-270-18] une opération de direction inconnue ne fait porter son délai à personne', () => {
    const debut = new Date('2026-10-10T08:00:00Z')
    const troisJoursPlusTard = new Date(debut.getTime() + 3 * 24 * 60 * 60 * 1000)
    const inconnue = {
      id: 'x1', date: '12/10', type: 'Ravitaillement', typePlie: 'ravitaillement',
      montant: 750000, statut: 'Validée', createdAt: debut, validatedAt: troisJoursPlusTard,
    }

    const t = texteFiche({ client, lignes: [inconnue], delai })
    expect(t).not.toMatch(/remis par la boutique/)
    expect(t).not.toMatch(/réglé en/)
    // Rien n'est inventé, mais rien de vrai n'est perdu non plus.
    // ⚠ LE SÉPARATEUR DE MILLIERS DE `toLocaleString('fr-FR')` N'EST PAS UNE
    //   ESPACE ORDINAIRE (c'est une espace insécable étroite, U+202F). Un
    //   `toContain('750 000')` tapé à la main échoue sur un texte pourtant
    //   juste — on construit donc l'attendu par le même chemin que le code.
    expect(t).toContain(`${(750000).toLocaleString('fr-FR')} FCFA`)
    expect(t).toContain('12/10')
  })

  /**
   * ⚠ RONDE DE CORRECTION 2 (R28) — « Validée » ET « Validee » COEXISTENT EN
   *   BASE, et la comparaison stricte accentuée faisait passer la seconde pour
   *   une anomalie. `storeTransactionCommand.js:773` écrit `statut: 'Validee'`
   *   SANS accent sur un retour de ravitaillement, là où `:169` écrit
   *   `'Validée'` avec. Une ligne parfaitement normale repartait donc suffixée
   *   « — Validee », qui se lit comme un problème, alors que l'écran l'affiche
   *   en vert : `tonStatut` (`src/utils/helpers.js`) teste par SOUS-CHAÎNE,
   *   exactement pour cette raison.
   *
   *   C'est le défaut de R23 pris par l'autre bout. R23 corrigeait un message
   *   plus RASSURANT que l'écran (une opération annulée sortait comme une
   *   valide) ; ici le message est plus ALARMANT que l'écran. Les deux sens
   *   violent la même règle : ne jamais affirmer plus que ce que le patron a
   *   sous les yeux.
   */
  it('[TC-270-19] « Validee » sans accent ne passe pas pour une anomalie', () => {
    const sansAccent = {
      id: 'v1', date: '15/10', type: 'Retour ravitaillement', typePlie: 'ravitaillement',
      montant: 12000, statut: 'Validee',
    }
    const annulee = {
      id: 'a1', date: '16/10', type: 'Retrait', typePlie: 'retrait',
      montant: 3000, statut: 'Annulée',
    }

    const t = texteFiche({ client, lignes: [sansAccent], delai })
    expect(t).not.toMatch(/— Validee/)
    // ⚠ `\s*` AVEC SON ANTISLASH. Écrite `/—s*Valid/`, cette ligne cherchait
    //   « zéro ou plusieurs lettres s » et ne pouvait donc JAMAIS matcher la
    //   sortie réelle (tiret, espace, statut) : une assertion toujours vraie,
    //   qui ne testait rien. Elle attrape maintenant toute orthographe de
    //   « Valid… » suffixée, quel que soit l'espacement.
    expect(t).not.toMatch(/—\s*Valid/i)

    // Et le vrai signal, lui, part toujours.
    const tAnnulee = texteFiche({ client, lignes: [annulee], delai })
    expect(tAnnulee).toMatch(/— Annulée/)
  })

  it('[TC-270-17] avec quatre opérations ou moins, pas de « des N » redondant', () => {
    const trois = Array.from({ length: 3 }, (_, i) => ({
      id: `h${i}`, date: `0${i + 1}/10`, type: 'Depot', typePlie: 'depot',
      statut: 'Validée', montant: 1000 * (i + 1),
    }))
    const t = texteFiche({ client, lignes: trois, delai })
    expect(t).toMatch(/3 dernières opérations/i)
    expect(t).not.toMatch(/des 3/i)
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
