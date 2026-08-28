import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { formatAmount } from '../constants/networkConfig'
import { useReducedMotion } from './useReducedMotion'

/**
 * Le montant qui se résout — la fin de l'arrivée, et sa seule partie utile.
 *
 * C'est ici que la séquence se termine, et ce n'est pas un ornement de plus :
 * un distributeur ouvre cette application pour savoir s'il peut ravitailler
 * l'agent suivant (REFONTE.md §1). Le chiffre EST la réponse. Le voir se poser
 * dit « le réseau a répondu » — une information, pas une décoration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL NE SE JOUE QU'UNE FOIS, ET C'EST LA RÈGLE QUI COMPTE
 *
 * Les soldes viennent d'un abonnement Firestore : ils changent toute la
 * journée, à chaque opération. Sans garde, CHAQUE mise à jour relancerait le
 * décompte — un solde qui se remettrait à défiler pendant qu'on saisit une
 * transaction ne serait pas une animation, ce serait une régression. Pire, il
 * rendrait le chiffre illisible au moment précis où on en a besoin.
 *
 * Le décompte n'a donc lieu qu'à la PREMIÈRE valeur. Ensuite, la valeur
 * s'affiche directement, et pour toujours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE FORMATAGE RESTE CELUI DU PRODUIT
 *
 * On passe par `formatAmount`, jamais par une mise en forme maison : les
 * milliers y sont séparés à la française, et un décompte qui grouperait
 * autrement ferait clignoter la ponctuation d'un chiffre à l'autre. Les cartes
 * sont déjà en chiffres tabulaires, donc la largeur ne bouge pas pendant le
 * décompte — c'était la condition pour que ce geste soit tenable.
 *
 * @param {number|undefined} valeur — le solde réel.
 * @returns {string} le montant formaté, prêt à afficher.
 */
export function useMontantAnime(valeur) {
  const mouvementReduit = useReducedMotion()
  const cible = Number.isFinite(valeur) ? valeur : 0

  /**
   * L'état de départ vaut ZÉRO quand on va compter — pas la valeur réelle.
   *
   * Dans l'autre sens, le premier rendu peint le bon montant, puis le décompte
   * démarre à l'image suivante et le fait retomber à zéro : on verrait le solde
   * juste, PUIS le regarderait remonter. Un scintillement qui donne au chiffre
   * exact l'air d'une erreur corrigée.
   *
   * `useReducedMotion` s'appuie sur `useSyncExternalStore` : sa valeur est
   * juste dès ce premier rendu, ce qui rend ce choix possible sans battement.
   */
  const [affiche, setAffiche] = useState(() => (mouvementReduit ? cible : 0))
  const dejaResolu = useRef(false)

  useEffect(() => {
    // Toute valeur qui n'est pas la première s'affiche telle quelle. Idem sous
    // mouvement réduit : la bonne réponse est le chiffre, tout de suite.
    if (dejaResolu.current || mouvementReduit) {
      dejaResolu.current = true
      setAffiche(cible)
      return undefined
    }

    dejaResolu.current = true

    // Un solde nul n'a rien à raconter : compter de 0 à 0 ne produirait qu'une
    // seconde d'immobilité qu'on prendrait pour un chargement bloqué.
    if (cible === 0) {
      setAffiche(0)
      return undefined
    }

    const etat = { valeur: 0 }
    const tween = gsap.to(etat, {
      valeur: cible,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: () => setAffiche(Math.round(etat.valeur)),
      // L'arrivée exacte n'est pas laissée à l'arrondi de la dernière image :
      // un solde faux d'une unité serait un défaut, pas une imprécision.
      onComplete: () => setAffiche(cible),
    })

    return () => tween.kill()
  }, [cible, mouvementReduit])

  return formatAmount(affiche)
}

export default useMontantAnime
