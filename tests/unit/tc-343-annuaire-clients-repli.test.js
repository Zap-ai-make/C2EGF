import { describe, it, expect, vi, afterEach } from 'vitest'
import { ecouterAvecRepli, lireAnnuaire } from '../../src/services/annuaireClients.js'

/**
 * TC-343 — lire la base clients par l'annuaire, avec l'ancien chemin en repli
 * (docs/rester-dans-le-quota-gratuit.md §A1).
 *
 * Ce que ce fichier verrouille : l'écran a TOUJOURS une liste entière. Par
 * l'annuaire quand il est complet (64 lectures), par `globalClients` sinon —
 * jamais une liste tronquée, jamais un écran vide parce que les règles ou le
 * remplissage n'ont pas encore été déployés.
 */

const docAnnuaire = (id, donnees) => ({ id, data: () => donnees })
const COMPLET = docAnnuaire('_etat', { complet: true, tranches: 64, fiches: 2 })

/** Une source simulée : garde son callback, compte ses ouvertures et fermetures. */
function source() {
  const s = { cb: null, ouvertures: 0, fermetures: 0 }
  s.ecouter = (cb) => {
    s.cb = cb
    s.ouvertures += 1
    return () => { s.fermetures += 1 }
  }
  return s
}

afterEach(() => vi.restoreAllMocks())

describe('TC-343 — lire l’annuaire', () => {
  it('[TC-343-01] sans `_etat`, l’annuaire n’est pas utilisable', () => {
    expect(lireAnnuaire([docAnnuaire('t00', { entrees: { c1: { nom: 'A' } } })])).toEqual({ complet: false, clients: [] })
  })

  it('[TC-343-02] un `_etat` qui ne dit pas « complet » non plus', () => {
    expect(lireAnnuaire([docAnnuaire('_etat', { complet: false })]).complet).toBe(false)
  })

  it('[TC-343-03] complet : les fiches de toutes les tranches, avec leur identifiant', () => {
    const lu = lireAnnuaire([
      COMPLET,
      docAnnuaire('t00', { entrees: { c1: { nom: 'OUEDRAOGO', prenom: 'Salif' } }, majLe: 'x' }),
      docAnnuaire('t01', { entrees: { c2: { nom: 'KABORE', prenom: 'Awa', codeAgent: '' } } }),
      docAnnuaire('t02', {}),
    ])
    expect(lu.complet).toBe(true)
    expect(lu.clients).toEqual([
      { id: 'c1', nom: 'OUEDRAOGO', prenom: 'Salif' },
      { id: 'c2', nom: 'KABORE', prenom: 'Awa', codeAgent: '' },
    ])
  })
})

describe('TC-343 — l’écran a toujours une liste entière', () => {
  it('[TC-343-04] annuaire complet : la liste vient de lui, le repli n’est jamais ouvert', () => {
    const annuaire = source()
    const repli = source()
    const onNext = vi.fn()
    ecouterAvecRepli({ ecouterAnnuaire: annuaire.ecouter, ecouterRepli: repli.ecouter }, { onNext })
    annuaire.cb({ complet: true, clients: [{ id: 'c1' }] })
    expect(onNext).toHaveBeenCalledWith([{ id: 'c1' }])
    expect(repli.ouvertures).toBe(0)
  })

  it('[TC-343-05] incomplet : le repli sert la liste, puis se ferme quand l’annuaire est prêt', () => {
    const annuaire = source()
    const repli = source()
    const onNext = vi.fn()
    ecouterAvecRepli({ ecouterAnnuaire: annuaire.ecouter, ecouterRepli: repli.ecouter }, { onNext })

    annuaire.cb({ complet: false, clients: [] })
    annuaire.cb({ complet: false, clients: [] })
    expect(repli.ouvertures).toBe(1)
    repli.cb([{ id: 'c1' }, { id: 'c2' }])
    expect(onNext).toHaveBeenLastCalledWith([{ id: 'c1' }, { id: 'c2' }])

    annuaire.cb({ complet: true, clients: [{ id: 'c1' }, { id: 'c2' }] })
    expect(repli.fermetures).toBe(1)
    expect(onNext).toHaveBeenLastCalledWith([{ id: 'c1' }, { id: 'c2' }])
  })

  it('[TC-343-06] annuaire refusé (règles pas déployées) : le repli prend la main, sans erreur à l’écran', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const annuaire = source()
    const repli = source()
    const onNext = vi.fn()
    const onError = vi.fn()
    ecouterAvecRepli({ ecouterAnnuaire: annuaire.ecouter, ecouterRepli: repli.ecouter }, { onNext, onError })
    annuaire.cb.onError(Object.assign(new Error('refusé'), { code: 'permission-denied' }))
    expect(repli.ouvertures).toBe(1)
    expect(onError).not.toHaveBeenCalled()
    repli.cb([{ id: 'c1' }])
    expect(onNext).toHaveBeenCalledWith([{ id: 'c1' }])
  })

  it('[TC-343-07] si le repli tombe à son tour, l’erreur atteint l’écran', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const annuaire = source()
    const repli = source()
    const onError = vi.fn()
    ecouterAvecRepli({ ecouterAnnuaire: annuaire.ecouter, ecouterRepli: repli.ecouter }, { onNext: vi.fn(), onError })
    annuaire.cb.onError(new Error('refusé'))
    const panne = new Error('réseau')
    repli.cb.onError(panne)
    expect(onError).toHaveBeenCalledWith(panne)
  })

  it('[TC-343-08] le désabonnement ferme les deux, et rien n’arrive plus après', () => {
    const annuaire = source()
    const repli = source()
    const onNext = vi.fn()
    const fermer = ecouterAvecRepli({ ecouterAnnuaire: annuaire.ecouter, ecouterRepli: repli.ecouter }, { onNext })
    annuaire.cb({ complet: false, clients: [] })
    fermer()
    expect(annuaire.fermetures).toBe(1)
    expect(repli.fermetures).toBe(1)
    annuaire.cb({ complet: true, clients: [{ id: 'tard' }] })
    expect(onNext).not.toHaveBeenCalled()
    expect(repli.ouvertures).toBe(1)
  })
})
