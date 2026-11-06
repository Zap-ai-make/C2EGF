import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './AuthContext'
import { EnvoisContext } from './envoisContexte.js'
import { db } from '../config/firebase'
import { EN_ATTENTE, REFUSEE, creerFileEnvoi } from '../services/fileEnvoi.js'
import { ouvrirStockageEnvois } from '../services/stockageEnvois.js'
import { executerEnvoi, verrouillerEnvois } from '../services/envois.js'
import { createIdempotencyKey } from '../utils/idempotencyKey'

/** Fournit la file d'envoi de la session boutique : voir `envoisContexte.js`. */
export function EnvoisProvider({ children }) {
  const { currentUser: user, userProfile, activeStore, loading } = useContext(AuthContext)
  const [file, setFile] = useState(null)
  const [operations, setOperations] = useState([])
  const uid = user?.uid
  const actif = !loading && Boolean(uid) && Boolean(userProfile?.storeId) && activeStore?.id === userProfile.storeId

  useEffect(() => {
    if (!actif) {
      setFile(null)
      setOperations([])
      return undefined
    }
    const nouvelle = creerFileEnvoi({
      stockage: ouvrirStockageEnvois({ projet: db?.app?.options?.projectId ?? 'projet', uid }),
      executer: executerEnvoi,
      nouvelId: createIdempotencyKey,
      verrouiller: verrouillerEnvois(uid),
    })
    const desabonner = nouvelle.abonner(setOperations)
    // Le retour du réseau relance l'envoi sans attendre l'essai suivant.
    // `navigator.onLine` ment sur un wifi sans internet : il ne sert qu'à
    // déclencher plus tôt, jamais à décider qu'on est en ligne.
    const relancer = () => { nouvelle.vider() }
    window.addEventListener('online', relancer)
    // Celles qu'une session précédente a laissées partent maintenant.
    nouvelle.vider()
    setFile(nouvelle)
    return () => {
      desabonner()
      window.removeEventListener('online', relancer)
      nouvelle.arreter()
    }
  }, [actif, uid])

  const soumettre = useCallback((type, charge, options) => (
    file
      ? file.soumettre(type, charge, options)
      : Promise.reject(new Error('Session boutique introuvable : opération non enregistrée.'))
  ), [file])

  const retirer = useCallback((id) => (file ? file.retirer(id) : Promise.resolve(false)), [file])

  const value = useMemo(() => ({
    disponible: Boolean(file),
    soumettre,
    retirer,
    operations,
    enAttente: operations.filter((op) => op.etat === EN_ATTENTE),
    refusees: operations.filter((op) => op.etat === REFUSEE),
  }), [file, soumettre, retirer, operations])

  return <EnvoisContext.Provider value={value}>{children}</EnvoisContext.Provider>
}
