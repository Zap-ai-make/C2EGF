import { useEffect, useState } from 'react'

/**
 * Le poste se croit-il en ligne ? `navigator.onLine`, suivi en direct.
 *
 * ⚠ « EN LIGNE » NE GARANTIT PAS QUE L'APPEL ABOUTIRA : un Wi-Fi sans internet
 *   compte comme en ligne. Ce hook sert à griser ce qui ne peut PAS marcher ;
 *   l'appel garde sa propre gestion d'échec.
 *
 * Le même suivi existe, privé, dans `components/patron/NouvelleBoutique.jsx`.
 * Il n'y est pas remplacé ici : un lot ne mêle pas une fonctionnalité et une
 * réécriture (AGENTS.md).
 */
export function useEnLigne() {
  const [enLigne, setEnLigne] = useState(() => navigator.onLine)
  useEffect(() => {
    const allume = () => setEnLigne(true)
    const eteint = () => setEnLigne(false)
    window.addEventListener('online', allume)
    window.addEventListener('offline', eteint)
    return () => {
      window.removeEventListener('online', allume)
      window.removeEventListener('offline', eteint)
    }
  }, [])
  return enLigne
}
