import { describe, it, expect } from 'vitest'
import {
  champsAgent,
  repartirValeurAgent,
  valeursAgent,
  libelleAgent,
  LONGUEUR_CODE_AGENT,
  LONGUEUR_NUMERO_AGENT,
} from '../../src/utils/agentFields.js'

/**
 * TC-233 — Code agent et numéro agent, séparés à la lecture.
 *
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────
 * Toutes les fiches clients déjà en production portent UN champ, `orange`, où
 * l'on a mis tantôt un code, tantôt un numéro. Ce fichier les range sans rien
 * réécrire — et deux erreurs sont possibles, dont aucune ne se verrait :
 *
 *   — ranger une valeur dans la mauvaise colonne, ce qui la rendrait
 *     introuvable à la recherche et ferait écrire un mauvais code sur une
 *     transaction ;
 *   — faire RESSURGIR le vieux champ sur une fiche dont la boutique a vidé les
 *     deux cases exprès. Une case effacée doit le rester.
 */

describe('TC-233 — la règle de tri', () => {
  it('[TC-233-1] huit chiffres, c’est un numéro agent', () => {
    expect(repartirValeurAgent('70112233')).toEqual({ codeAgent: '', numeroAgent: '70112233' })
  })

  it('[TC-233-2] sept chiffres, c’est un code agent', () => {
    expect(repartirValeurAgent('1234567')).toEqual({ codeAgent: '1234567', numeroAgent: '' })
  })

  it('[TC-233-3] les longueurs sont bien celles du terrain', () => {
    expect(LONGUEUR_NUMERO_AGENT).toBe(8)
    expect(LONGUEUR_CODE_AGENT).toBe(7)
  })

  /**
   * Une valeur de longueur inattendue doit atterrir quelque part. Le code agent
   * est ce qui alimente le code de la transaction : s'y tromper laisse la valeur
   * utilisable, l'inverse la perdrait pour la saisie.
   */
  it('[TC-233-4] toute autre longueur tombe dans le code agent', () => {
    expect(repartirValeurAgent('123456').codeAgent).toBe('123456')
    expect(repartirValeurAgent('123456789').codeAgent).toBe('123456789')
  })

  it('[TC-233-5] compte les chiffres, pas les séparateurs', () => {
    // « 70 11 22 33 » reste un numéro agent : huit chiffres, des espaces en plus.
    expect(repartirValeurAgent('70 11 22 33')).toEqual({ codeAgent: '', numeroAgent: '70 11 22 33' })
  })

  it('[TC-233-6] une valeur vide ne remplit rien', () => {
    expect(repartirValeurAgent('')).toEqual({ codeAgent: '', numeroAgent: '' })
    expect(repartirValeurAgent(null)).toEqual({ codeAgent: '', numeroAgent: '' })
    expect(repartirValeurAgent('   ')).toEqual({ codeAgent: '', numeroAgent: '' })
  })
})

describe('TC-233 — les fiches d’avant la séparation', () => {
  it('[TC-233-7] un ancien numéro se lit comme un numéro agent', () => {
    expect(champsAgent({ orange: '70112233' })).toEqual({ codeAgent: '', numeroAgent: '70112233' })
  })

  it('[TC-233-8] un ancien code se lit comme un code agent', () => {
    expect(champsAgent({ orange: '1234567' })).toEqual({ codeAgent: '1234567', numeroAgent: '' })
  })

  it('[TC-233-9] une fiche sans rien ne rend rien', () => {
    expect(champsAgent({})).toEqual({ codeAgent: '', numeroAgent: '' })
    expect(champsAgent(null)).toEqual({ codeAgent: '', numeroAgent: '' })
  })
})

describe('TC-233 — les fiches déjà séparées', () => {
  it('[TC-233-10] les deux champs sont lus tels quels', () => {
    const client = { codeAgent: '1234567', numeroAgent: '70112233' }
    expect(champsAgent(client)).toEqual({ codeAgent: '1234567', numeroAgent: '70112233' })
  })

  /**
   * ⚠ LA PROPRIÉTÉ LA PLUS IMPORTANTE DU FICHIER.
   *   Une fiche enregistrée depuis la séparation porte TOUJOURS les deux clés,
   *   quitte à ce qu'elles soient vides. Si l'on testait la VALEUR plutôt que la
   *   présence, vider les deux cases ferait reparaître le vieux `orange` — la
   *   boutique effacerait une donnée et la verrait revenir au rechargement.
   */
  it('[TC-233-11] une case vidée exprès ne fait pas ressurgir l’ancien champ', () => {
    const client = { codeAgent: '', numeroAgent: '', orange: '1234567' }
    expect(champsAgent(client)).toEqual({ codeAgent: '', numeroAgent: '' })
  })

  it('[TC-233-12] une seule clé présente suffit à considérer la fiche rangée', () => {
    expect(champsAgent({ numeroAgent: '70112233', orange: '9999999' }))
      .toEqual({ codeAgent: '', numeroAgent: '70112233' })
  })
})

describe('TC-233 — ce qu’on en montre', () => {
  it('[TC-233-13] les valeurs non vides, pour chercher', () => {
    expect(valeursAgent({ codeAgent: '1234567', numeroAgent: '70112233' }))
      .toEqual(['1234567', '70112233'])
    expect(valeursAgent({ codeAgent: '1234567', numeroAgent: '' })).toEqual(['1234567'])
    expect(valeursAgent({})).toEqual([])
  })

  it('[TC-233-14] un libellé qui nomme ce qu’il montre', () => {
    expect(libelleAgent({ codeAgent: '1234567', numeroAgent: '70112233' }))
      .toBe('Code 1234567 · N° 70112233')
    expect(libelleAgent({ numeroAgent: '70112233' })).toBe('N° 70112233')
    expect(libelleAgent({})).toBe('')
  })

  it('[TC-233-15] et qui marche aussi sur une fiche d’avant', () => {
    expect(libelleAgent({ orange: '70112233' })).toBe('N° 70112233')
  })
})
