import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-368 — « Nouvelle boutique », l'écran qui remplace la console Firebase.
 *
 * Le patron remplit trois champs ; l'écran contrôle avant d'appeler, montre les
 * identifiants à transmettre, puis les efface. Le serveur et l'écoute des
 * boutiques sont simulés : TC-367 et TC-366 les tiennent.
 */

const creerBoutique = vi.fn()
vi.mock('../../src/services/boutiquesService.js', () => ({
  creerBoutique: (...a) => creerBoutique(...a),
}))

const attendreBoutiqueActive = vi.fn()
vi.mock('../../src/services/boutiquesActives.js', () => ({
  attendreBoutiqueActive: (...a) => attendreBoutiqueActive(...a),
}))

const { default: NouvelleBoutique } = await import('../../src/components/patron/NouvelleBoutique.jsx')

const CREEE = { storeId: 'c2egf-koudougou-abc123', uid: 'abc123', nom: 'C2EGF Koudougou', email: 'koudougou@c2egf.test', dejaCreee: false }

let onCreee
beforeEach(() => {
  creerBoutique.mockReset().mockResolvedValue(CREEE)
  attendreBoutiqueActive.mockReset().mockResolvedValue(true)
  onCreee = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ouvrir = () => {
  render(<NouvelleBoutique onCreee={onCreee} />)
  fireEvent.click(screen.getByRole('button', { name: /nouvelle boutique/i }))
}

const remplir = ({ nom = 'C2EGF Koudougou', email = 'koudougou@c2egf.test', motDePasse = 'mot-de-passe-1' } = {}) => {
  fireEvent.change(screen.getByLabelText('Nom de la boutique'), { target: { value: nom } })
  fireEvent.change(screen.getByLabelText('E-mail de connexion'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: motDePasse } })
}

const creer = () => fireEvent.click(screen.getByRole('button', { name: 'Créer la boutique' }))

describe('TC-368 — le formulaire', () => {
  it('[NB-01] le bouton ouvre un formulaire de trois champs', () => {
    ouvrir()
    expect(screen.getByTestId('nouvelle-boutique')).toBeInTheDocument()
    expect(screen.getByLabelText('Nom de la boutique')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail de connexion')).toBeInTheDocument()
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument()
  })

  it.each([
    ['un nom trop court', { nom: 'A' }, /nom/i],
    ['un e-mail sans arobase', { email: 'koudougou.c2egf.test' }, /e-mail invalide/i],
    ['un mot de passe de 7 caractères', { motDePasse: '1234567' }, /8 caractères/i],
  ])('[NB-02] refuse %s avant tout appel', (_cas, champs, message) => {
    ouvrir()
    remplir(champs)
    creer()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(creerBoutique).not.toHaveBeenCalled()
  })

  it('[NB-03] « Générer » remplit un mot de passe de 10 caractères sans caractère ambigu', () => {
    ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Générer' }))
    expect(screen.getByLabelText('Mot de passe').value).toMatch(/^[a-hjkmnp-z2-9]{10}$/)
  })
})

describe('TC-368 — la création', () => {
  it('[NB-04] crée la boutique et montre les identifiants à transmettre', async () => {
    ouvrir()
    remplir()
    creer()

    expect(await screen.findByText('Boutique créée')).toBeInTheDocument()
    expect(creerBoutique).toHaveBeenCalledWith({ nom: 'C2EGF Koudougou', email: 'koudougou@c2egf.test', motDePasse: 'mot-de-passe-1' })
    expect(screen.getByText('koudougou@c2egf.test')).toBeInTheDocument()
    expect(screen.getByText('mot-de-passe-1')).toBeInTheDocument()
  })

  it('[NB-05] la liste est relue une fois la boutique arrivée dans l’écoute', async () => {
    let arrivee
    attendreBoutiqueActive.mockReturnValue(new Promise((r) => { arrivee = r }))
    ouvrir()
    remplir()
    creer()

    await screen.findByText('Boutique créée')
    expect(attendreBoutiqueActive).toHaveBeenCalledWith('c2egf-koudougou-abc123')
    expect(onCreee).not.toHaveBeenCalled()

    arrivee(true)
    await waitFor(() => expect(onCreee).toHaveBeenCalledWith(CREEE))
  })

  it('[NB-06] un refus du serveur s’affiche, et le formulaire reste rempli', async () => {
    creerBoutique.mockRejectedValue(new Error('Cet e-mail sert déjà à un autre compte.'))
    ouvrir()
    remplir()
    creer()

    expect(await screen.findByRole('alert')).toHaveTextContent('Cet e-mail sert déjà à un autre compte.')
    expect(screen.getByLabelText('Nom de la boutique').value).toBe('C2EGF Koudougou')
    expect(onCreee).not.toHaveBeenCalled()
  })

  it('[NB-07] un double clic n’envoie qu’une demande', async () => {
    creerBoutique.mockReturnValue(new Promise(() => {}))
    ouvrir()
    remplir()
    const bouton = screen.getByRole('button', { name: 'Créer la boutique' })
    fireEvent.click(bouton)
    fireEvent.click(bouton)

    expect(await screen.findByRole('button', { name: 'Création…' })).toBeDisabled()
    expect(creerBoutique).toHaveBeenCalledTimes(1)
  })

  it('[NB-08] une boutique reprise après un premier essai ne montre pas un mot de passe peut-être faux', async () => {
    creerBoutique.mockResolvedValue({ ...CREEE, dejaCreee: true })
    ouvrir()
    remplir()
    creer()

    expect(await screen.findByText('Cette boutique existait déjà')).toBeInTheDocument()
    expect(screen.queryByText('mot-de-passe-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copier/i })).not.toBeInTheDocument()
  })
})

describe('TC-368 — après la création', () => {
  it('[NB-09] « Copier les identifiants » met les trois lignes dans le presse-papiers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    ouvrir()
    remplir()
    creer()
    fireEvent.click(await screen.findByRole('button', { name: 'Copier les identifiants' }))

    expect(await screen.findByRole('button', { name: 'Copié' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('Boutique : C2EGF Koudougou\nE-mail : koudougou@c2egf.test\nMot de passe : mot-de-passe-1')
  })

  it('[NB-10] fermer efface le mot de passe : la réouverture montre un formulaire vide', async () => {
    ouvrir()
    remplir()
    creer()
    await screen.findByText('Boutique créée')

    // La croix de l'en-tête s'appelle aussi « Fermer » ; ici, le bouton du pied.
    fireEvent.click(screen.getByText('Fermer', { selector: 'button' }))
    fireEvent.click(screen.getByRole('button', { name: /nouvelle boutique/i }))

    expect(screen.getByLabelText('Mot de passe').value).toBe('')
    expect(screen.getByLabelText('Nom de la boutique').value).toBe('')
  })
})

describe('TC-368 — sans connexion', () => {
  it('[NB-11] le bouton est grisé et le dit', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<NouvelleBoutique onCreee={onCreee} />)

    expect(screen.getByRole('button', { name: /nouvelle boutique/i })).toBeDisabled()
    expect(screen.getByText('Connexion requise')).toBeInTheDocument()
  })
})
