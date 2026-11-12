/**
 * TC-376 — Liaison Oxygen : les règles pures (functions/src/oxygen/liaison.js).
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.2.
 *
 * Ce qui est verrouillé ici, sans Firestore :
 *   • l'identifiant : chiffres seuls, et les TROIS champs d'une fiche (codeAgent,
 *     numeroAgent, l'ancien `orange`) ;
 *   • la clé du verrou « un seul compte actif », tirée de la FICHE et jamais de la
 *     saisie : le code agent s'il existe, sinon le numéro agent ;
 *   • le code de liaison : six chiffres, empreinte liée à la fiche ;
 *   • la décision sur un code saisi, dans l'ordre du contrat (déjà utilisé,
 *     annulé, expiré), le rejeu, et le cinquième échec qui annule ;
 *   • l'appartenance d'une opération aux périodes d'un compte.
 */

import { describe, it, expect } from 'vitest'
import {
  chiffres,
  champsAgentFiche,
  cleVerrou,
  ficheCorrespond,
  genererCode,
  hacherCode,
  verifierCode,
  dansLesPeriodes,
  ECHECS_MAX,
  DUREE_CODE_MS,
} from '../../functions/src/oxygen/liaison.js'

describe('TC-376 — identifiants', () => {
  it('[TC-376-01] ne garde que les chiffres', () => {
    expect(chiffres(' 70 11-22.33 ')).toBe('70112233')
    expect(chiffres(null)).toBe('')
  })

  it('[TC-376-02] lit une fiche d’avant la séparation par la longueur de `orange`', () => {
    expect(champsAgentFiche({ orange: '1234567' })).toEqual({ codeAgent: '1234567', numeroAgent: '' })
    expect(champsAgentFiche({ orange: '70112233' })).toEqual({ codeAgent: '', numeroAgent: '70112233' })
  })

  it('[TC-376-03] décide par la PRÉSENCE des clés, comme src/utils/agentFields.js', () => {
    // Une case vidée exprès reste vide : l'ancien `orange` ne doit pas ressurgir.
    expect(champsAgentFiche({ codeAgent: '', numeroAgent: '', orange: '1234567' }))
      .toEqual({ codeAgent: '', numeroAgent: '' })
  })

  it('[TC-376-04] la clé du verrou est le code agent, à défaut le numéro agent', () => {
    expect(cleVerrou({ codeAgent: '123 4567', numeroAgent: '70112233' })).toBe('1234567')
    expect(cleVerrou({ codeAgent: '', numeroAgent: '70 11 22 33' })).toBe('70112233')
    expect(cleVerrou({ orange: '1234567' })).toBe('1234567')
    expect(cleVerrou({ codeAgent: '', numeroAgent: '' })).toBeNull()
  })

  it('[TC-376-05] une fiche correspond par l’un de ses trois champs, en chiffres', () => {
    const fiche = { codeAgent: '1234567', numeroAgent: '70 11 22 33', orange: '1234567' }
    expect(ficheCorrespond(fiche, '1234567')).toBe(true)
    expect(ficheCorrespond(fiche, '70112233')).toBe(true)
    expect(ficheCorrespond({ orange: '7654321' }, '7654321')).toBe(true)
    expect(ficheCorrespond(fiche, '7654321')).toBe(false)
    expect(ficheCorrespond(fiche, '')).toBe(false)
  })
})

describe('TC-376 — le code de liaison', () => {
  it('[TC-376-06] six chiffres, zéros de tête compris', () => {
    for (let i = 0; i < 50; i += 1) expect(genererCode()).toMatch(/^\d{6}$/)
  })

  it('[TC-376-07] tiré au hasard : vingt tirages ne donnent pas vingt fois le même', () => {
    expect(new Set(Array.from({ length: 20 }, genererCode)).size).toBeGreaterThan(1)
  })

  it('[TC-376-08] l’empreinte dépend de la fiche : le même code ne vaut pas pour une autre', () => {
    expect(hacherCode('fiche-a', '123456')).toMatch(/^[0-9a-f]{64}$/)
    expect(hacherCode('fiche-a', '123456')).toBe(hacherCode('fiche-a', '123456'))
    expect(hacherCode('fiche-a', '123456')).not.toBe(hacherCode('fiche-b', '123456'))
  })

  it('[TC-376-09] le code vit quinze minutes et tolère quatre échecs', () => {
    expect(DUREE_CODE_MS).toBe(15 * 60 * 1000)
    expect(ECHECS_MAX).toBe(5)
  })
})

describe('TC-376 — décision sur un code saisi', () => {
  const T = Date.UTC(2026, 10, 12, 10, 0)
  const bon = hacherCode('f1', '111111')
  const actif = (over = {}) => ({
    codeHache: bon, hachePrecedent: null, expireLe: T + DUREE_CODE_MS,
    utiliseLe: null, utilisePar: null, objet: null, echecs: 0, ...over,
  })
  const decider = (doc, code = '111111', over = {}) =>
    verifierCode(doc, { empreinte: hacherCode('f1', code), compteOxygen: 'cpt-1', objet: 'liaison', maintenantMs: T, ...over })

  it('[TC-376-10] aucun code pour la fiche : incorrect, et rien à compter', () => {
    expect(decider(null)).toEqual({ refus: 'code_incorrect' })
  })

  it('[TC-376-11] le bon code, valable : accepté', () => {
    expect(decider(actif())).toEqual({ accepte: true })
  })

  it('[TC-376-12] rejoué par le même compte pour le même objet : la même réponse', () => {
    expect(decider(actif({ utiliseLe: T - 1000, utilisePar: 'cpt-1', objet: 'liaison' }))).toEqual({ rejoue: true })
  })

  it('[TC-376-13] déjà utilisé par un autre compte, ou pour un autre objet', () => {
    expect(decider(actif({ utiliseLe: T - 1000, utilisePar: 'cpt-2', objet: 'liaison' })))
      .toEqual({ refus: 'code_deja_utilise' })
    expect(decider(actif({ utiliseLe: T - 1000, utilisePar: 'cpt-1', objet: 'code_secret' })))
      .toEqual({ refus: 'code_deja_utilise' })
  })

  it('[TC-376-14] annulé par cinq échecs, même si le bon code arrive ensuite', () => {
    expect(decider(actif({ echecs: ECHECS_MAX }))).toEqual({ refus: 'code_annule' })
  })

  it('[TC-376-15] expiré à la quinzième minute pile', () => {
    expect(decider(actif({ expireLe: T }))).toEqual({ refus: 'code_expire' })
  })

  it('[TC-376-16] l’ancien code d’une fiche, remplacé par un plus récent : annulé', () => {
    const doc = actif({ codeHache: hacherCode('f1', '222222'), hachePrecedent: bon })
    expect(decider(doc)).toEqual({ refus: 'code_annule' })
  })

  it('[TC-376-17] un mauvais code compte un échec', () => {
    expect(decider(actif({ echecs: 2 }), '999999')).toEqual({ refus: 'code_incorrect', echecs: 3 })
  })

  it('[TC-376-18] le cinquième échec annule le code, et le dit', () => {
    expect(decider(actif({ echecs: ECHECS_MAX - 1 }), '999999'))
      .toEqual({ refus: 'code_annule', echecs: ECHECS_MAX, epuise: true })
  })

  it('[TC-376-19] un mauvais code sur un code mort ne compte plus rien', () => {
    expect(decider(actif({ expireLe: T - 1 }), '999999')).toEqual({ refus: 'code_incorrect' })
    expect(decider(actif({ utiliseLe: T - 1, utilisePar: 'cpt-9', objet: 'liaison' }), '999999'))
      .toEqual({ refus: 'code_incorrect' })
    expect(decider(actif({ echecs: ECHECS_MAX }), '999999')).toEqual({ refus: 'code_incorrect' })
  })

  it('[TC-376-20] lit aussi un horodatage Firestore', () => {
    const horodatage = (ms) => ({ toMillis: () => ms })
    expect(decider(actif({ expireLe: horodatage(T - 1) }))).toEqual({ refus: 'code_expire' })
  })
})

describe('TC-376 — périodes d’un compte', () => {
  const p = (debut, fin = null) => ({ debutLe: { toMillis: () => debut }, finLe: fin === null ? null : { toMillis: () => fin } })

  it('[TC-376-21] début inclus, fin exclue', () => {
    expect(dansLesPeriodes(100, [p(100, 200)])).toBe(true)
    expect(dansLesPeriodes(199, [p(100, 200)])).toBe(true)
    expect(dansLesPeriodes(200, [p(100, 200)])).toBe(false)
    expect(dansLesPeriodes(99, [p(100, 200)])).toBe(false)
  })

  it('[TC-376-22] une liaison active court jusqu’à maintenant et au-delà', () => {
    expect(dansLesPeriodes(10_000, [p(100)])).toBe(true)
  })

  it('[TC-376-23] plusieurs périodes : il suffit d’en être dans une', () => {
    expect(dansLesPeriodes(350, [p(100, 200), p(300)])).toBe(true)
    expect(dansLesPeriodes(250, [p(100, 200), p(300)])).toBe(false)
  })

  it('[TC-376-24] une opération sans date n’appartient à personne', () => {
    expect(dansLesPeriodes(0, [p(0)])).toBe(false)
    expect(dansLesPeriodes(Number.NaN, [p(100)])).toBe(false)
  })
})
