import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

// AdminProfile a disparu avec le shell a neuf ecrans (lot 3) : le compte du
// patron vit desormais dans l'en-tete d'AdminLayout (TC-266), pas dans une
// page dediee. DealerProfile n'est pas touche par ce lot — il garde son banc
// de caracterisation, qui n'a plus de raison d'etre partage avec un tableau.
import DealerProfile from '../../src/pages/dealer/DealerProfile'

const USER_PROFILE = {
  name: 'Awa Ouédraogo',
  email: 'awa@c2egf.bf',
}

describe.each([
  {
    name: 'dealer',
    Component: DealerProfile,
    testId: 'dealer-profile',
    title: 'Profil Dealer',
    role: 'Dealer',
  },
])('page de profil $name', ({ Component, testId, title, role }) => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ userProfile: USER_PROFILE })
  })

  it('affiche le titre et les trois informations du compte', () => {
    render(<Component />)

    const page = screen.getByTestId(testId)
    expect(within(page).getByRole('heading', { level: 2, name: title })).toBeTruthy()
    expect(within(page).getByText(USER_PROFILE.name)).toBeTruthy()
    expect(within(page).getByText(USER_PROFILE.email)).toBeTruthy()
    expect(within(page).getByText(role)).toBeTruthy()
  })

  it('garde la fiche vide tant que le profil n’est pas chargé', () => {
    mocks.useAuth.mockReturnValue({ userProfile: null })
    render(<Component />)

    expect(screen.getByTestId(testId).querySelector('dl')).toBeNull()
  })
})
