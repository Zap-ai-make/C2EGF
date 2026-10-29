import { describe, expect, it } from 'vitest'
import { construirePrompt, INTERDITS } from '../../src/lib/ia/prompt.js'
import {
  CLES_DESTINATIONS,
  DESTINATIONS,
  clesAtteignables,
  resoudreDestination,
} from '../../src/lib/ia/destinations.js'
import { STORE_ACCOUNT_ITEM, STORE_NAV_ITEMS } from '../../src/constants/navigation.js'
import { GESTES, lireGeste } from '../../src/lib/ia/gestes.js'
import { analyserFragments, analyserMarkdown } from '../../src/lib/ia/markdown.js'

/**
 * tc-300 — les modules PURS de l'assistant.
 *
 * Un prompt décide de ce que l'assistant répond ; une phrase retirée par
 * inadvertance ne se voit pas à la compilation. Ces tests figent les interdits
 * qui coûteraient de l'argent réel.
 */

describe('[PR] prompt système', () => {
  it('[PR-01] porte la date du jour, qu\'un modèle ne connaît pas', () => {
    const prompt = construirePrompt({ date: new Date('2026-03-14T10:00:00Z') })
    expect(prompt).toContain('14 mars 2026')
  })

  it('[PR-02] nomme la personne et sa boutique', () => {
    const prompt = construirePrompt({ nom: 'Awa', boutique: 'Gounghin', role: 'store_admin' })
    expect(prompt).toContain('Awa')
    expect(prompt).toContain('Gounghin')
    expect(prompt).toContain('responsable de la boutique')
  })

  it('[PR-03] tient sans contexte, sans rendre « undefined »', () => {
    const prompt = construirePrompt()
    expect(prompt).not.toContain('undefined')
    expect(prompt).not.toContain('null')
  })

  it.each(INTERDITS)('[PR-04] figé dans le prompt : « %s »', (interdit) => {
    expect(construirePrompt()).toContain(interdit)
  })

  it('[PR-05] interdit d\'annoncer un enregistrement — la phrase la plus dangereuse', () => {
    expect(construirePrompt()).toContain("n'annonce jamais qu'une opération a été enregistrée")
  })

  it('[PR-06] distingue créance et règlement, que le métier distingue', () => {
    const prompt = construirePrompt()
    expect(prompt).toContain('CRÉANCE')
    expect(prompt).toContain('RÈGLEMENT')
    expect(prompt).toContain('ne désigne rien')
  })

  it('[PR-07] dit qu\'un ravitaillement n\'est pas du chiffre d\'affaires', () => {
    expect(construirePrompt()).toContain("n'entre pas dans le chiffre d'affaires")
  })

  it('[PR-08] borne le périmètre à la boutique', () => {
    const prompt = construirePrompt({ boutique: 'Gounghin' })
    expect(prompt).toContain('que les données de Gounghin')
    expect(prompt).toContain('pour cette boutique et pour elle seule')
  })

  /**
   * ⚠ On ne peut PAS exiger l'absence de « collection », « document » ou
   *   « requête » : l'interdit lui-même doit les nommer pour les proscrire.
   *   On vérifie donc deux choses distinctes — que l'interdit est bien posé, et
   *   qu'aucun nom de machinerie PROPRE au produit n'a fui dans le texte.
   */
  it('[PR-08b] pose l\'interdit de jargon, sans laisser fuir de machinerie', () => {
    const prompt = construirePrompt({ boutique: 'Gounghin' })
    expect(prompt).toContain('ne parle jamais de collection, document, requête')
    for (const machinerie of ['Firestore', 'permission-denied', 'globalClients', 'storeId', 'uid']) {
      expect(prompt).not.toContain(machinerie)
    }
  })

  it('[PR-09] énumère les écrans, et seulement ceux du catalogue', () => {
    const prompt = construirePrompt()
    for (const cle of CLES_DESTINATIONS) expect(prompt).toContain(cle)
  })
})

describe('[DE] catalogue de destinations', () => {
  it('[DE-01] chaque destination porte un chemin absolu et un libellé', () => {
    for (const cle of CLES_DESTINATIONS) {
      expect(DESTINATIONS[cle].chemin.startsWith('/')).toBe(true)
      expect(DESTINATIONS[cle].libelle.length).toBeGreaterThan(2)
      expect(DESTINATIONS[cle].quand.length).toBeGreaterThan(5)
    }
  })

  it('[DE-02] aucun chemin dynamique : le modèle ne compose pas un identifiant', () => {
    for (const cle of CLES_DESTINATIONS) {
      expect(DESTINATIONS[cle].chemin).not.toContain(':')
    }
  })

  it('[DE-03] aucune destination hors de l\'espace boutique', () => {
    for (const cle of CLES_DESTINATIONS) {
      const chemin = DESTINATIONS[cle].chemin
      expect(chemin.startsWith('/admin')).toBe(false)
      expect(chemin === '/dealer' || chemin.startsWith('/dealer/')).toBe(false)
    }
  })

  it('[DE-04] un écran inconnu est REFUSÉ, pas rapproché du plus proche', () => {
    const resultat = resoudreDestination('comptabilite')
    expect(resultat.ok).toBe(false)
    expect(resultat.raison).toContain('comptabilite')
  })

  it('[DE-05] une clé vide ou absente est refusée sans lever', () => {
    for (const entree of [undefined, null, '', 42, {}]) {
      expect(resoudreDestination(entree).ok).toBe(false)
    }
  })
})

/**
 * L'assistant n'emmène que là où la barre de navigation mène. Le profil
 * C2EGF masque le tableau de bord, le formulaire séparé et les demandes au
 * dealer : les proposer, c'était ouvrir à la caissière un écran que sa
 * navigation ne montre pas — et « les ravitaillements » y désignait les
 * demandes au dealer, pas le ravitaillement de l'onglet Transactions.
 */
describe('[DA] destinations atteignables', () => {
  it('[DA-01] barre C2EGF : Transactions, Clients, Historique, et le Profil', () => {
    expect(clesAtteignables(['/transactions', '/clients', '/historique', '/profil']))
      .toEqual(['clients', 'transactions', 'historique', 'profil'])
  })

  it('[DA-02] barre complète du pilote : tout sauf les clôtures, qu\'aucun lien ne mène', () => {
    expect(clesAtteignables(['/', '/transactions', '/formulaire', '/dealer-requests', '/dettes', '/clients', '/historique', '/profil']))
      .toEqual(['accueil', 'clients', 'transactions', 'historique', 'nouvelleTransaction', 'ravitaillements', 'profil'])
  })

  it('[DA-03] le catalogue réel ne contient que des écrans de la barre ou du compte', () => {
    const chemins = new Set([...STORE_NAV_ITEMS.map((item) => item.path), STORE_ACCOUNT_ITEM.path])
    for (const cle of CLES_DESTINATIONS) {
      expect(chemins.has(DESTINATIONS[cle].chemin)).toBe(true)
    }
  })

  it('[DA-04] un écran connu mais hors de la barre est refusé, nommément', () => {
    const resultat = resoudreDestination('clotures')

    expect(resultat.ok).toBe(false)
    expect(resultat.raison).toBeTruthy()
  })
})

describe('[GE] lecture des gestes', () => {
  it('[GE-01] proposer et aller rendent le même chemin, un geste différent', () => {
    const aller = lireGeste('aller_a', { ecran: 'clients' })
    const proposer = lireGeste('proposer_l_ecran', { ecran: 'clients' })
    expect(aller.chemin).toBe(proposer.chemin)
    expect(aller.geste).toBe(GESTES.ALLER)
    expect(proposer.geste).toBe(GESTES.PROPOSER)
  })

  it('[GE-02] fermer ne demande aucun argument', () => {
    expect(lireGeste('fermer_l_assistant')).toEqual({ ok: true, geste: GESTES.FERMER })
  })

  it('[GE-03] un écran inconnu refuse au lieu de naviguer', () => {
    expect(lireGeste('aller_a', { ecran: '/admin' }).ok).toBe(false)
  })

  it('[GE-04] un outil inconnu refuse sans lever', () => {
    expect(lireGeste('supprimer_tout', {}).ok).toBe(false)
  })
})

describe('[MD] balisage du modèle', () => {
  it('[MD-01] ne rend jamais de HTML : les chevrons restent du texte', () => {
    const blocs = analyserMarkdown('<img src=x onerror="alert(1)"> fin')
    const texte = blocs[0].fragments.map((f) => f.texte).join('')
    expect(texte).toContain('<img')
    expect(blocs[0].type).toBe('paragraphe')
  })

  it('[MD-02] découpe une liste à puces', () => {
    const blocs = analyserMarkdown('Voici :\n- un\n- deux')
    expect(blocs[0].type).toBe('paragraphe')
    expect(blocs[1].type).toBe('liste')
    expect(blocs[1].elements).toHaveLength(2)
  })

  it('[MD-03] reconnaît le gras sans perdre le texte autour', () => {
    const fragments = analyserFragments('total **15 000 FCFA** aujourd\'hui')
    expect(fragments.map((f) => f.texte).join('')).toBe("total 15 000 FCFA aujourd'hui")
    expect(fragments.find((f) => f.gras).texte).toBe('15 000 FCFA')
  })

  it('[MD-04] une entrée vide ou non textuelle rend une liste vide', () => {
    for (const entree of ['', '   ', undefined, null, 12]) {
      expect(analyserMarkdown(entree)).toEqual([])
    }
  })
})
