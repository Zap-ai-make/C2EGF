import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './AuthContext'
import { EnvoisContext } from './envoisContexte.js'
import { db } from '../config/firebase'
import { EN_ATTENTE, REFUSEE, SIGNAL_APRES_MS, attenteASignaler, creerFileEnvoi } from '../services/fileEnvoi.js'
import { ouvrirStockageEnvois } from '../services/stockageEnvois.js'
import { executerEnvoi, verrouillerEnvois } from '../services/envois.js'
import { createIdempotencyKey } from '../utils/idempotencyKey'

/** Fournit la file d'envoi de la session boutique : voir `envoisContexte.js`. */
export function EnvoisProvider({ children }) {
  const { currentUser: user, userProfile, activeStore, loading } = useContext(AuthContext)
  const [file, setFile] = useState(null)
  const [operations, setOperations] = useState([])
  const [enLigne, setEnLigne] = useState(() => navigator.onLine)
  const [instant, setInstant] = useState(() => Date.now())
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
    // L'heure est relue avec la liste, dans le même rendu : jugée avec une heure
    // figée, l'opération qui suit celle qui vient de partir paraîtrait fraîche, et le
    // bandeau s'éteindrait un instant avant de revenir.
    const desabonner = nouvelle.abonner((liste) => {
      setOperations(liste)
      setInstant(Date.now())
    })
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

  const apresEnvoi = useCallback((ecouteur) => (file ? file.apresEnvoi(ecouteur) : () => {}), [file])

  useEffect(() => {
    const oui = () => setEnLigne(true)
    const non = () => setEnLigne(false)
    window.addEventListener('online', oui)
    window.addEventListener('offline', non)
    return () => {
      window.removeEventListener('online', oui)
      window.removeEventListener('offline', non)
    }
  }, [])

  const enAttente = useMemo(() => operations.filter((op) => op.etat === EN_ATTENTE), [operations])
  const refusees = useMemo(() => operations.filter((op) => op.etat === REFUSEE), [operations])
  const signalerAttente = attenteASignaler(enAttente, { enLigne, maintenant: instant })

  // Réseau présent, rien ne se dit pendant les premières secondes (lot H). On se
  // réveille à l'échéance de la plus ancienne, pour le dire si elle n'est pas partie.
  useEffect(() => {
    if (enAttente.length === 0 || signalerAttente) return undefined
    const echeance = Math.min(...enAttente.map((op) => op.creeLe)) + SIGNAL_APRES_MS
    const minuteur = setTimeout(() => setInstant(Date.now()), Math.max(0, echeance - Date.now()))
    return () => clearTimeout(minuteur)
  }, [enAttente, signalerAttente, instant])

  const value = useMemo(() => ({
    disponible: Boolean(file),
    soumettre,
    retirer,
    apresEnvoi,
    operations,
    enAttente,
    refusees,
    signalerAttente,
  }), [file, soumettre, retirer, apresEnvoi, operations, enAttente, refusees, signalerAttente])

  return <EnvoisContext.Provider value={value}>{children}</EnvoisContext.Provider>
}
