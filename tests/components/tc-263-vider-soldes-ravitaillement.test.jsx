import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/**
 * TC-263 — Vider les soldes est refusé tant qu'une livraison n'est pas rendue.
 *
 * POURQUOI L'ÉCRAN LE DIT AUSSI, ALORS QUE LE SERVEUR REFUSE DÉJÀ
 * ──────────────────────────────────────────────────────────────
 * Le serveur est l'autorité (TC-217-10..16) : l'écran peut être périmé ou
 * contourné, et c'est de l'argent. Mais un refus qui n'arrive qu'APRÈS le clic
 * se lit comme une panne. Ici l'écran explique AVANT le geste, et le serveur
 * reste le dernier mot.
 *
 * ⚠ CE QUI EST EN JEU. Un ravitaillement AJOUTE aux soldes, un retour les
 *   PONCTIONNE : l'argent dû au dealer est assis dans les soldes. Les vider
 *   détruit les fonds qui serviraient à le rendre, pendant que la dette survit
 *   sur la ligne de ravitaillement.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()

vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ networkData: { Orange: { stock: 600_066, liquidite: 401_934 } } }),
}))
vi.mock('../../src/services/storeTransactionCommandService', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))

const { default: ViderSoldesForm } = await import('../../src/components/transactions/ViderSoldesForm.jsx')

const livraison = (over = {}) => ({
  id: 'rav-1', type: 'Ravitaillement', montant: 500_000, remainingAmount: 350_000, ...over,
})

const afficher = (props = {}) => render(
  <ViderSoldesForm onComplete={vi.fn()} onCancel={vi.fn()} {...props} />,
)

beforeEach(() => { runStoreTransactionCommand.mockReset(); showToast.mockReset() })
afterEach(cleanup)

describe('TC-263 — une livraison due bloque le geste', () => {
  it('[TC-263-01] le bouton est désactivé tant qu’une livraison est due', () => {
    afficher({ ravitaillements: [livraison()] })
    expect(screen.getByTestId('confirmer-vider-soldes')).toBeDisabled()
  })

  /** Un bouton grisé sans raison se lit comme une panne. */
  it('[TC-263-02] le message dit combien, et combien', () => {
    afficher({ ravitaillements: [livraison(), livraison({ id: 'rav-2', remainingAmount: 150_000 })] })
    const bloc = screen.getByTestId('ravitaillements-bloquants')
    expect(bloc).toHaveTextContent(/2 ravitaillements non retournés/)
    expect(bloc).toHaveTextContent(/500\s?000/)
  })

  /**
   * ⚠ `\b` NE S'ACCROCHE PAS APRÈS « é ». Première écriture de ce test :
   *   `/1 ravitaillement non retourné\b/`, qui ne matche jamais — sans le
   *   drapeau `u`, « é » n'est pas un caractère de mot, donc il n'y a pas de
   *   frontière entre lui et l'espace. On vérifie l'absence du pluriel, ce qui
   *   dit la même chose sans dépendre de cette subtilité.
   */
  it('[TC-263-03] une seule livraison se dit au singulier', () => {
    afficher({ ravitaillements: [livraison()] })
    const bloc = screen.getByTestId('ravitaillements-bloquants')
    expect(bloc).toHaveTextContent(/1 ravitaillement non retourné/)
    expect(bloc).not.toHaveTextContent(/ravitaillements/)
    expect(bloc).not.toHaveTextContent(/retournés/)
  })

  /** ⚠ Le message explique la CONSÉQUENCE, pas seulement l'état. */
  it('[TC-263-04] le message dit pourquoi c’est refusé', () => {
    afficher({ ravitaillements: [livraison()] })
    expect(screen.getByTestId('ravitaillements-bloquants')).toHaveTextContent(/fonds qui servent à les rendre/)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI COMPTE VRAIMENT : rien ne part. Un bouton désactivé qui
   *   laisserait quand même passer un clic programmatique ne protège de rien.
   */
  it('[TC-263-05] aucun appel serveur ne part', () => {
    afficher({ ravitaillements: [livraison()] })
    fireEvent.click(screen.getByTestId('confirmer-vider-soldes'))
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })
})

describe('TC-263 — sans livraison due, rien ne change', () => {
  it('[TC-263-06] le bouton reste actif', () => {
    afficher({ ravitaillements: [] })
    expect(screen.getByTestId('confirmer-vider-soldes')).toBeEnabled()
    expect(screen.queryByTestId('ravitaillements-bloquants')).toBeNull()
  })

  it('[TC-263-07] le geste part bien', () => {
    runStoreTransactionCommand.mockResolvedValue({ id: 'h1' })
    afficher({ ravitaillements: [] })
    fireEvent.click(screen.getByTestId('confirmer-vider-soldes'))
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'closeDay' })
  })

  /**
   * ⚠ LA PROP ABSENTE NE DOIT PAS BLOQUER. Le formulaire est aussi rendu par
   *   d'autres chemins ; un garde-fou qui se déclenche sur `undefined`
   *   empêcherait de vider les soldes partout où la prop a été oubliée — un
   *   blocage total, et silencieux.
   */
  it('[TC-263-08] sans la prop, le bouton reste actif', () => {
    afficher()
    expect(screen.getByTestId('confirmer-vider-soldes')).toBeEnabled()
  })
})

/**
 * ⚠ LE CÂBLAGE EST LA MOITIÉ QUI MANQUE LE PLUS SOUVENT. Le formulaire sait
 *   bloquer, mais il ne bloque que si la page lui PASSE les livraisons dues.
 *   Sans ce test, les huit précédents resteraient verts avec un écran qui ne
 *   bloque jamais rien.
 */
describe('TC-263 — la page passe bien les livraisons dues au formulaire', () => {
  it('[TC-263-09] `Transactions` fournit la prop `ravitaillements`', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/pages/Transactions.jsx', 'utf8')

    const appel = source.slice(source.indexOf('<ViderSoldesForm'))
    expect(appel.slice(0, appel.indexOf('/>'))).toMatch(/ravitaillements=\{/)
  })
})
