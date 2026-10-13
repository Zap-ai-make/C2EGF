import { describe, it, expect } from 'vitest'
import {
  chercherClients,
  filtrerClients,
  plierTexte,
  chiffresSeuls,
  identifiantsDe,
} from '../../src/utils/rechercheClients.js'

/**
 * TC-252 — Retrouver une fiche à partir de ce que la caissière tape.
 *
 * CE QUE CES TESTS PROTÈGENT
 * ──────────────────────────
 * Signalé en boutique : « quand je cherche, pour certains agents ça s'affiche et
 * pour d'autres non ». Ce n'était pas aléatoire — c'était quatre défauts précis,
 * et chacun a son test ici :
 *
 *   1. CHAQUE CHAMP ÉTAIT TESTÉ SÉPARÉMENT. Taper « OUEDRAOGO SALIF » ne trouvait
 *      rien : le nom est dans `nom`, le prénom dans `prenom`, et aucun des deux
 *      ne contient la chaîne entière. Le geste le plus naturel était le seul qui
 *      échouait.
 *   2. AUCUN PLIAGE D'ACCENTS, dans une base qui en est pleine.
 *   3. AUCUNE NORMALISATION DES NUMÉROS : « 70 11 22 33 » ≠ « 70112233 ».
 *   4. DIX RÉSULTATS SANS CLASSEMENT : sur un nom courant, la bonne fiche était
 *      souvent au-delà — donc absente de l'écran, donc « pas dans la base ».
 *
 * ⚠ LE POINT 4 EST LE PLUS TRAÎTRE : rien ne distingue, à l'écran, une fiche
 *   absente d'une fiche coupée par la limite. C'est pour ça que `chercherClients`
 *   rend `reste` et que l'écran l'affiche.
 */

const SEPAREE = {
  id: 'c-1',
  nom: 'OUEDRAOGO',
  prenom: 'SALIF',
  codeAgent: '0123456',
  numeroAgent: '01234567',
  numeroPersonnel: '70112233',
}

const ACCENTUEE = {
  id: 'c-2',
  nom: 'OUÉDRAOGO',
  prenom: 'Aïssata',
  codeAgent: '0999888',
  numeroPersonnel: '65432100',
}

/** Fiche jamais rouverte depuis la séparation : tout vit encore dans `orange`. */
const ANCIENNE = {
  id: 'c-3',
  nom: 'KABORE',
  prenom: 'Salif',
  orange: '70998877',
  numeroPersonnel: '65000011',
}

/**
 * ⚠ LE CAS QUE `champsAgent` NE VOIT PAS : les deux clés existent et sont vides,
 *   la vieille valeur dort dans `orange`. Pour l'affichage c'est juste — une case
 *   vidée exprès doit le rester. Pour la RECHERCHE ce serait une fiche invisible.
 */
const VIDEE_MAIS_ANCIENNE = {
  id: 'c-4',
  nom: 'SANA',
  prenom: 'Issa',
  codeAgent: '',
  numeroAgent: '',
  orange: '7654321',
}

const TOUS = [SEPAREE, ACCENTUEE, ANCIENNE, VIDEE_MAIS_ANCIENNE]

const ids = (clients, terme, options) => chercherClients(clients, terme, options).resultats.map((c) => c.id)

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-252 — le pli du texte et des numéros', () => {
  it('[TC-252-01] plie accents, casse et espaces multiples', () => {
    expect(plierTexte('  OUÉDRAOGO   Aïssata ')).toBe('ouedraogo aissata')
  })

  it('[TC-252-02] ne garde que les chiffres d’un numéro', () => {
    expect(chiffresSeuls('+226 70 11 22 33')).toBe('22670112233')
    expect(chiffresSeuls('70-11-22-33')).toBe('70112233')
    expect(chiffresSeuls('')).toBe('')
  })

  it('[TC-252-03] rassemble les identifiants, `orange` compris', () => {
    expect(identifiantsDe(SEPAREE)).toEqual(expect.arrayContaining(['0123456', '01234567', '70112233']))
    expect(identifiantsDe(VIDEE_MAIS_ANCIENNE)).toContain('7654321')
  })
})

describe('TC-252 — trouver par chacun des cinq champs', () => {
  it('[TC-252-04] par nom', () => {
    expect(ids(TOUS, 'ouedraogo')).toEqual(expect.arrayContaining(['c-1', 'c-2']))
  })

  it('[TC-252-05] par prénom', () => {
    expect(ids(TOUS, 'aissata')).toEqual(['c-2'])
  })

  it('[TC-252-06] par code agent', () => {
    expect(ids(TOUS, '0123456')).toEqual(['c-1'])
  })

  it('[TC-252-07] par numéro agent', () => {
    expect(ids(TOUS, '01234567')).toEqual(['c-1'])
  })

  it('[TC-252-08] par numéro personnel', () => {
    expect(ids(TOUS, '65432100')).toEqual(['c-2'])
  })

  it('[TC-252-09] une fiche d’avant la séparation par sa vieille valeur', () => {
    expect(ids(TOUS, '70998877')).toEqual(['c-3'])
  })

  /** ⚠ Sans la lecture directe d'`orange`, cette fiche serait introuvable. */
  it('[TC-252-10] une fiche dont les deux clés sont vides mais dont `orange` porte le code', () => {
    expect(ids(TOUS, '7654321')).toEqual(['c-4'])
  })
})

describe('TC-252 — les quatre défauts signalés en boutique', () => {
  /** ⚠ LE DÉFAUT PRINCIPAL : le nom complet ne trouvait rien. */
  it('[TC-252-11] le nom complet trouve, alors que ses deux moitiés sont deux champs', () => {
    expect(ids(TOUS, 'OUEDRAOGO SALIF')).toEqual(['c-1'])
  })

  it('[TC-252-12] l’ordre des mots n’a pas d’importance', () => {
    expect(ids(TOUS, 'salif ouedraogo')).toEqual(['c-1'])
  })

  it('[TC-252-13] les accents ne séparent plus deux écritures du même nom', () => {
    expect(ids(TOUS, 'ouedraogo aissata')).toEqual(['c-2'])
    expect(ids(TOUS, 'OUÉDRAOGO')).toEqual(expect.arrayContaining(['c-1', 'c-2']))
  })

  it('[TC-252-14] un numéro écrit avec des espaces ou des tirets trouve quand même', () => {
    expect(ids(TOUS, '70 11 22 33')).toEqual(['c-1'])
    expect(ids(TOUS, '011 234 567')).toEqual(['c-1'])
  })

  it('[TC-252-15] un début de code suffit', () => {
    expect(ids(TOUS, '01234')).toEqual(expect.arrayContaining(['c-1']))
  })

  it('[TC-252-16] un terme inconnu ne rend rien', () => {
    expect(ids(TOUS, 'zzzz')).toEqual([])
  })

  it('[TC-252-17] un terme vide ne cherche rien', () => {
    expect(chercherClients(TOUS, '')).toEqual({ resultats: [], total: 0, reste: 0 })
    expect(chercherClients(TOUS, '   ')).toEqual({ resultats: [], total: 0, reste: 0 })
  })

  it('[TC-252-18] une liste vide ou absente ne casse rien', () => {
    expect(chercherClients([], 'kone')).toEqual({ resultats: [], total: 0, reste: 0 })
    expect(chercherClients(null, 'kone')).toEqual({ resultats: [], total: 0, reste: 0 })
    expect(chercherClients([null, undefined, SEPAREE], 'ouedraogo').resultats).toEqual([SEPAREE])
  })
})

describe('TC-252 — le classement, qui rend la limite supportable', () => {
  const homonymes = Array.from({ length: 30 }, (_, i) => ({
    id: `h-${i}`,
    nom: 'OUEDRAOGO',
    prenom: `Prenom${i}`,
    codeAgent: `010000${String(i).padStart(2, '0')}`,
  }))
  const cible = { id: 'cible', nom: 'OUEDRAOGO', prenom: 'Zacharia', codeAgent: '0987654' }
  const base = [...homonymes, cible]

  /**
   * ⚠ C'EST CE TEST QUI DÉCRIT LE BUG VÉCU. Trente homonymes, le bon en dernier :
   *   sans classement, taper son code agent entier ne le faisait pas apparaître.
   */
  it('[TC-252-19] le code agent tapé en entier place la fiche en TÊTE', () => {
    const { resultats } = chercherClients(base, '0987654', { maximum: 10 })
    expect(resultats[0].id).toBe('cible')
  })

  it('[TC-252-20] un identifiant exact passe devant une simple correspondance', () => {
    const { resultats } = chercherClients(
      [{ id: 'partiel', nom: 'TEST', prenom: 'Un', codeAgent: '09876540' }, cible],
      '0987654',
      { maximum: 10 },
    )
    expect(resultats[0].id).toBe('cible')
  })

  it('[TC-252-21] la limite est respectée, et le reste est annoncé', () => {
    const { resultats, total, reste } = chercherClients(base, 'ouedraogo', { maximum: 10 })
    expect(resultats).toHaveLength(10)
    expect(total).toBe(31)
    expect(reste).toBe(21)
  })

  it('[TC-252-22] sans limite, tout est rendu et le reste est nul', () => {
    const { resultats, reste } = chercherClients(base, 'ouedraogo')
    expect(resultats).toHaveLength(31)
    expect(reste).toBe(0)
  })
})

describe('TC-252 — le filtre de la liste des clients', () => {
  it('[TC-252-23] rend la liste entière quand rien n’est tapé', () => {
    expect(filtrerClients(TOUS, '')).toBe(TOUS)
    expect(filtrerClients(TOUS, '  ')).toBe(TOUS)
  })

  it('[TC-252-24] couvre exactement les mêmes cas que la barre de transaction', () => {
    expect(filtrerClients(TOUS, 'OUEDRAOGO SALIF').map((c) => c.id)).toEqual(['c-1'])
    expect(filtrerClients(TOUS, '70 11 22 33').map((c) => c.id)).toEqual(['c-1'])
    expect(filtrerClients(TOUS, '7654321').map((c) => c.id)).toEqual(['c-4'])
  })
})
