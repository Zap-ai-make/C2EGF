/**
 * tc-109 — le wordmark découpé reste un nom.
 *
 * L'animation elle-même est en CSS : elle ne se teste pas ici, elle se REGARDE
 * (`npm run capture`) et se mesure (`npm run mouvement`, qui compare l'état
 * d'arrivée à l'état sous mouvement réduit, au pixel près).
 *
 * Ce que ce fichier fige, c'est le PRIX du découpage. Pour animer les lettres
 * une à une, il faut les séparer — et une séparation mal faite transforme un
 * nom de marque en suite de caractères pour tout ce qui lit la page : lecteurs
 * d'écran, recherche du navigateur, sélection, traduction.
 *
 * Ces assertions ne portent sur aucune classe de présentation. Elles disent que
 * le nom reste un nom.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BandeauMarque from '../../src/components/BandeauMarque.jsx'
import { APP_NAME } from '../../src/constants/branding.js'

/**
 * Les espaces du wordmark sont INSÉCABLES (U+00A0) : dans une suite de blocs en
 * ligne, une espace ordinaire se réduirait à rien et le nom se lirait
 * « C2EGFBURKINA ». On normalise donc avant de comparer — sans quoi ce test
 * échouerait sur une différence invisible à la relecture.
 */
const normaliser = (texte) => texte.replace(/\s+/g, ' ').trim()

describe('tc-109 — le wordmark découpé reste un nom', () => {
  it('annonce le nom entier, et jamais ses lettres', () => {
    render(<BandeauMarque />)

    // `getByLabelText` interroge l'arbre d'accessibilité : c'est très
    // exactement ce qu'un lecteur d'écran annoncera.
    expect(screen.getByLabelText(APP_NAME)).toBeInTheDocument()
  })

  it('garde le texte entier dans le DOM', () => {
    const { container } = render(<BandeauMarque />)
    const wordmark = container.querySelector('[aria-label]')

    // La recherche dans la page, la sélection et la traduction opèrent sur le
    // texte rendu. Le découpage ne doit donc pas le fragmenter en contenu, mais
    // seulement en balisage.
    expect(normaliser(wordmark.textContent)).toBe(APP_NAME)
  })

  it('masque les fragments de l’arbre d’accessibilité', () => {
    const { container } = render(<BandeauMarque />)
    const wordmark = container.querySelector('[aria-label]')

    // Sans ce masquage, le nom serait annoncé DEUX fois : une par l'étiquette,
    // une par le contenu épelé.
    expect(wordmark.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('produit une lettre par caractère du nom', () => {
    const { container } = render(<BandeauMarque />)

    // Le nom vient du profil client : le découpage doit suivre la valeur réelle,
    // pas un compte figé.
    expect(container.querySelectorAll('.wordmark-lettre')).toHaveLength([...APP_NAME].length)
  })

  /**
   * LE DÉCALAGE PART DU CENTRE, et c'est l'énoncé du concept, pas un effet.
   *
   * La marque est exactement au-dessus du milieu du nom : la propagation part de
   * là. Un rang qui vaudrait la position produirait une vague de gauche à
   * droite. Le rang est donc symétrique — première et dernière lettre le
   * partagent —, et minimal au centre.
   */
  it('décale les lettres depuis le centre, pas depuis la gauche', () => {
    const { container } = render(<BandeauMarque />)
    const rangs = [...container.querySelectorAll('.wordmark-masque')].map((noeud) =>
      Number(noeud.style.getPropertyValue('--rang'))
    )

    expect(rangs[0]).toBe(rangs[rangs.length - 1])
    expect(Math.min(...rangs)).toBe(rangs[Math.floor((rangs.length - 1) / 2)])
    expect(Math.max(...rangs)).toBe(rangs[0])
  })
})
