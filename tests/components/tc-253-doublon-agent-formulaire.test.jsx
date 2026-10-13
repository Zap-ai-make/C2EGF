import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ClientForm from '../../src/components/ClientForm.jsx'
import { ClientsContext } from '../../src/context/ClientsContext.jsx'
import { AuthContext } from '../../src/context/AuthContext.jsx'

/**
 * TC-253 — Le code agent déjà pris se voit PENDANT la saisie.
 *
 * CE QUI MANQUAIT
 * ───────────────
 * Le serveur refusait déjà un doublon (`_refuserDoublonAgent`), mais à la fin :
 * on remplissait quinze champs pour apprendre que la fiche existait déjà. Le
 * refus arrivait au moment le plus coûteux, et ne proposait rien — il fallait
 * ensuite retrouver la fiche à la main dans quinze mille.
 *
 * ⚠ LE CONTRÔLE LOCAL NE REMPLACE PAS CELUI DU SERVEUR, il le devance. La liste
 *   en mémoire peut être en retard d'une seconde sur la base ; c'est pour ça que
 *   `_refuserDoublonAgent` reste le dernier mot, et que ce formulaire doit
 *   continuer de fonctionner SANS la liste (voir le dernier bloc).
 *
 * ⚠ LA FICHE D'UNE AUTRE BOUTIQUE EST MODIFIABLE, décision du 2026-10-13 : la
 *   fiche client est commune. L'avertissement nomme la boutique d'origine comme
 *   une information, pas comme un obstacle — et propose la même ouverture.
 */

const MIENNE = {
  id: 'fiche-a',
  nom: 'OUEDRAOGO',
  prenom: 'SALIF',
  codeAgent: '0123456',
  numeroAgent: '01234567',
  localite: 'POUYTENGA',
  registeredStoreId: 'store-A',
  registeredStoreName: 'C2EGF OUAGA',
}

const AUTRE_BOUTIQUE = {
  id: 'fiche-b',
  nom: 'KABORE',
  prenom: 'ISSA',
  codeAgent: '0999888',
  registeredStoreId: 'store-B',
  registeredStoreName: 'C2EGF BOBO',
}

/** Fiche d'avant la séparation : son identifiant dort encore dans `orange`. */
const ANCIENNE = {
  id: 'fiche-c',
  nom: 'SANA',
  prenom: 'ISSA',
  orange: '7654321',
  registeredStoreId: 'store-A',
  registeredStoreName: 'C2EGF OUAGA',
}

const CLIENTS = [MIENNE, AUTRE_BOUTIQUE, ANCIENNE]

const afficher = ({ clients = CLIENTS, initialData = null, onOuvrirFiche, onSubmit = vi.fn() } = {}) => render(
  <AuthContext.Provider value={{ userProfile: { storeId: 'store-A' } }}>
    <ClientsContext.Provider value={{ clients }}>
      <ClientForm onSubmit={onSubmit} initialData={initialData} onOuvrirFiche={onOuvrirFiche} />
    </ClientsContext.Provider>
  </AuthContext.Provider>,
)

const taper = (libelle, valeur) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } })

// L'étoile des champs obligatoires fait partie du libellé, et « Nom » tout seul
// désignerait aussi « Nom de l'agent commercial ».
const OBLIGATOIRE_NOM = /^Nom \*/
const OBLIGATOIRE_PRENOM = /^Prénom \*/

afterEach(cleanup)

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-253 — l’avertissement apparaît à la saisie', () => {
  it('[TC-253-01] rien ne s’affiche tant que le code est inconnu', () => {
    afficher()
    taper('Code agent', '0000001')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[TC-253-02] un code agent déjà pris nomme la fiche qui le porte', () => {
    afficher()
    taper('Code agent', '0123456')

    const alerte = screen.getByRole('alert')
    expect(alerte).toHaveTextContent('OUEDRAOGO SALIF')
    expect(alerte).toHaveTextContent('dans cette boutique')
  })

  it('[TC-253-03] un numéro agent déjà pris est détecté de la même façon', () => {
    afficher()
    taper('Numéro agent', '01234567')
    expect(screen.getByRole('alert')).toHaveTextContent('OUEDRAOGO SALIF')
  })

  /**
   * ⚠ LE CROISEMENT DES DEUX COLONNES. Une opératrice qui tape un NUMÉRO agent
   *   dans la case CODE agent doit être arrêtée aussi : l'identifiant est pris,
   *   quelle que soit la case où il a été écrit.
   */
  it('[TC-253-04] un numéro agent tapé dans la case code agent est détecté', () => {
    afficher()
    taper('Code agent', '01234567')
    expect(screen.getByRole('alert')).toHaveTextContent('OUEDRAOGO SALIF')
  })

  /** La base entière est dans cet état : sans `orange`, le contrôle serait aveugle. */
  it('[TC-253-05] détecte une fiche d’avant la séparation par sa vieille valeur', () => {
    afficher()
    taper('Code agent', '7654321')
    expect(screen.getByRole('alert')).toHaveTextContent('SANA ISSA')
  })

  it('[TC-253-06] l’avertissement donne de quoi reconnaître la fiche', () => {
    afficher()
    taper('Code agent', '0123456')
    const alerte = screen.getByRole('alert')
    expect(alerte).toHaveTextContent('Code 0123456')
    expect(alerte).toHaveTextContent('POUYTENGA')
  })

  it('[TC-253-07] l’avertissement disparaît dès que la saisie change', () => {
    afficher()
    taper('Code agent', '0123456')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    taper('Code agent', '0000001')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('TC-253 — la fiche d’une autre boutique', () => {
  it('[TC-253-08] nomme la boutique d’origine et annonce que la fiche est commune', () => {
    afficher()
    taper('Code agent', '0999888')

    const alerte = screen.getByRole('alert')
    expect(alerte).toHaveTextContent('KABORE ISSA')
    expect(alerte).toHaveTextContent('C2EGF BOBO')
    expect(alerte).toHaveTextContent(/commune/)
  })

  it('[TC-253-09] propose la même ouverture que pour une fiche de la boutique', () => {
    const onOuvrirFiche = vi.fn()
    afficher({ onOuvrirFiche })
    taper('Code agent', '0999888')

    fireEvent.click(screen.getByRole('button', { name: /Ouvrir sa fiche/ }))
    expect(onOuvrirFiche).toHaveBeenCalledWith(AUTRE_BOUTIQUE)
  })
})

describe('TC-253 — l’enregistrement est bloqué', () => {
  it('[TC-253-10] le bouton est désactivé tant que le doublon est là', () => {
    afficher()
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    expect(bouton).toBeEnabled()

    taper('Code agent', '0123456')
    expect(bouton).toBeDisabled()
  })

  /**
   * ⚠ LE BOUTON GRISÉ NE SUFFIT PAS : un formulaire se soumet aussi par la touche
   *   Entrée. Le refus doit donc vivre dans `handleSubmit`, pas seulement dans
   *   l'attribut `disabled`.
   */
  it('[TC-253-11] la soumission directe est refusée, et rien n’est envoyé', () => {
    const onSubmit = vi.fn()
    const { container } = afficher({ onSubmit })

    taper(OBLIGATOIRE_NOM, 'NOUVEAU')
    taper(OBLIGATOIRE_PRENOM, 'CLIENT')
    taper('Code agent', '0123456')
    fireEvent.submit(container.querySelector('form'))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('[TC-253-12] sans doublon, la soumission passe normalement', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { container } = afficher({ onSubmit })

    taper(OBLIGATOIRE_NOM, 'NOUVEAU')
    taper(OBLIGATOIRE_PRENOM, 'CLIENT')
    taper('Code agent', '0000001')
    fireEvent.submit(container.querySelector('form'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('TC-253 — modifier une fiche existante', () => {
  /**
   * ⚠ UNE FICHE N'EST PAS SON PROPRE DOUBLON. Sans l'exclusion par identifiant,
   *   ouvrir une fiche pour corriger sa localité afficherait « ce code est déjà
   *   pris » — par elle-même — et interdirait d'enregistrer.
   */
  it('[TC-253-13] la fiche en cours de modification ne se signale pas elle-même', () => {
    afficher({ initialData: MIENNE })
    expect(screen.getByLabelText('Code agent')).toHaveValue('0123456')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeEnabled()
  })

  it('[TC-253-14] mais y recopier le code d’une AUTRE fiche est bien signalé', () => {
    afficher({ initialData: MIENNE })
    taper('Code agent', '0999888')
    expect(screen.getByRole('alert')).toHaveTextContent('KABORE ISSA')
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeDisabled()
  })
})

describe('TC-253 — sans la liste des clients', () => {
  /**
   * ⚠ LE FORMULAIRE DOIT VIVRE SANS LE FOURNISSEUR. Le contrôle de doublon est un
   *   confort de saisie, pas une condition d'existence : `useClients()` aurait
   *   levé, et un écran de saisie cassé est pire qu'un avertissement manquant.
   *   Le serveur, lui, refuse dans tous les cas.
   */
  it('[TC-253-15] se rend sans fournisseur, et n’avertit simplement de rien', () => {
    render(<ClientForm onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code agent'), { target: { value: '0123456' } })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })

  it('[TC-253-16] une liste vide ne signale rien non plus', () => {
    afficher({ clients: [] })
    taper('Code agent', '0123456')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  /** Sans moyen d'ouvrir la fiche, on le dit au lieu d'offrir un bouton inerte. */
  it('[TC-253-17] sans `onOuvrirFiche`, l’avertissement dit où aller', () => {
    afficher({ onOuvrirFiche: undefined })
    taper('Code agent', '0123456')

    expect(screen.queryByRole('button', { name: /Ouvrir sa fiche/ })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/liste des clients/)
  })
})
