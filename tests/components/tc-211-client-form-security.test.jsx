import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ClientForm from '../../src/components/ClientForm.jsx'
import { getStorageKey } from '../../src/config/clientIsolation.js'

describe('TC-211 — formulaire client', () => {
  it('purge l’ancien brouillon PII et associe chaque libellé à son champ', () => {
    const storageKey = getStorageKey('client_form_draft')
    localStorage.setItem(storageKey, JSON.stringify({ nom: 'Donnée sensible' }))

    render(<ClientForm onSubmit={vi.fn()} />)

    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(screen.getByLabelText(/^Nom \*/)).toHaveValue('')
    expect(screen.getByLabelText(/^Prénom \*/)).toHaveValue('')
    expect(screen.getByLabelText("Numéro d'identité")).toBeInTheDocument()
    expect(screen.getByLabelText('Numéro personnel')).toBeInTheDocument()
    expect(screen.getByLabelText('Code agent')).toBeInTheDocument()
    expect(screen.getByLabelText('Numéro agent')).toBeInTheDocument()
    expect(screen.getByLabelText('Localité')).toBeInTheDocument()
    expect(screen.getByLabelText("Nom de l'agent commercial")).toBeInTheDocument()
  })
})
