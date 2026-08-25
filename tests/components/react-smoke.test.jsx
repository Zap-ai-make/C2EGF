import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

function Greeting({ name }) {
  return <p>Bonjour {name}</p>
}

describe('react-smoke', () => {
  it('renders a greeting', () => {
    render(<Greeting name="AKAYIS" />)
    expect(screen.getByText('Bonjour AKAYIS')).toBeInTheDocument()
  })
})
