import { useState, useEffect, useMemo, useContext } from 'react'
import PageHeader from './ui/PageHeader'
import { useToast } from '../hooks/useToast'
import { getStorageKey } from '../config/clientIsolation'
import { champsAgent, libelleAgent, trouverFicheAgent, messageFicheExistante } from '../utils/agentFields.js'
import { ClientsContext } from '../context/ClientsContext.jsx'
import { AuthContext } from '../context/AuthContext'
import Toast from './Toast'

const EMPTY_CLIENT_FORM = {
  nom: '',
  prenom: '',
  numeroIdentite: '',
  numeroPersonnel: '',
  // Deux champs distincts depuis la séparation. `orange` n'est plus saisi : il
  // reste lu sur les fiches d'avant, et jamais réécrit.
  codeAgent: '',
  numeroAgent: '',
  moov: '',
  telecel: '',
  coris: '',
  sank: '',
  localite: '',
  agentCommercial: ''
}

const LEGACY_CLIENT_FORM_DRAFT_KEY = getStorageKey('client_form_draft')

function ClientForm({ onSubmit, initialData = null, title = 'Ajouter un client', embedded = false, onOuvrirFiche = null }) {
  const { toasts, showToast, removeToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState(EMPTY_CLIENT_FORM)

  // ⚠ LES CONTEXTES SONT LUS SANS LEUR HOOK, DÉLIBÉRÉMENT. `useClients()` lève
  //   quand le fournisseur manque — ce qui est juste pour un écran qui ne peut
  //   pas vivre sans la liste, et faux ici : le contrôle de doublon est un
  //   confort de saisie, pas une condition d'existence du formulaire. Sans
  //   fournisseur (un test de rendu isolé), il s'efface au lieu de tout casser.
  //   Le serveur, lui, refuse dans tous les cas — voir `_refuserDoublonAgent`.
  const clientsContext = useContext(ClientsContext)
  const authContext = useContext(AuthContext)
  const clientsConnus = clientsContext?.clients
  const storeIdCourant = authContext?.userProfile?.storeId ?? null

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_CLIENT_FORM_DRAFT_KEY)
    } catch {
      // Le stockage peut être indisponible ; le formulaire reste en mémoire uniquement.
    }
  }, [])

  // Charger les données initiales si on modifie
  useEffect(() => {
    if (initialData) {
      setFormData({
        nom: initialData.nom || '',
        prenom: initialData.prenom || '',
        numeroIdentite: initialData.numeroIdentite || '',
        numeroPersonnel: initialData.numeroPersonnel || '',
        // Une fiche d'avant la séparation arrive avec son seul `orange` : on la
        // PRÉ-RÉPARTIT ici, pour que la modifier suffise à la ranger pour de bon.
        ...champsAgent(initialData),
        moov: initialData.moov || '',
        telecel: initialData.telecel || '',
        coris: initialData.coris || '',
        sank: initialData.sank || '',
        localite: initialData.localite || '',
        agentCommercial: initialData.agentCommercial || ''
      })
    }
  }, [initialData])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  /**
   * La fiche qui porte déjà le code ou le numéro en train d'être tapé.
   *
   * ⚠ LE CONTRÔLE SE FAIT PENDANT LA SAISIE, PAS À L'ENREGISTREMENT. Le serveur
   *   refusait déjà un doublon, mais à la fin : on remplissait quinze champs
   *   pour apprendre que la fiche existait. Ici la liste des clients est déjà en
   *   mémoire — aucune requête réseau —, donc le signal peut arriver au moment
   *   où l'information devient utile, c'est-à-dire tout de suite.
   *
   *   On cherche les DEUX champs, et chacun dans les deux colonnes : la boutique
   *   qui tape un numéro agent dans la case code agent doit être arrêtée aussi.
   */
  const codeAgentSaisi = formData.codeAgent
  const numeroAgentSaisi = formData.numeroAgent

  const doublonAgent = useMemo(() => {
    for (const [champ, saisieBrute] of [['codeAgent', codeAgentSaisi], ['numeroAgent', numeroAgentSaisi]]) {
      const saisie = String(saisieBrute ?? '').trim()
      if (!saisie) continue
      const existant = trouverFicheAgent(clientsConnus ?? [], saisie, initialData?.id ?? null)
      if (existant) return { champ, saisie, existant }
    }
    return null
  }, [codeAgentSaisi, numeroAgentSaisi, clientsConnus, initialData?.id])

  const handleSubmit = async (e) => {
    e.preventDefault()

    // ⚠ LE BLOCAGE EST ICI AUSSI, et pas seulement sur le bouton désactivé. Un
    //   formulaire se soumet aussi par la touche Entrée, et un bouton grisé ne
    //   l'en empêche pas dans tous les navigateurs.
    if (doublonAgent) {
      showToast(messageFicheExistante(doublonAgent.existant, storeIdCourant), 'error')
      return
    }

    // Validation alignée sur validClient() de firestore.rules (nom/prenom : 2-50 caractères)
    if (!formData.nom || !formData.prenom) {
      showToast('Le nom et le prénom sont obligatoires', 'error')
      return
    }
    if (formData.nom.length < 2) {
      showToast('Le nom doit comporter au moins 2 caractères', 'error')
      return
    }
    if (formData.nom.length > 50) {
      showToast('Le nom ne peut pas dépasser 50 caractères', 'error')
      return
    }
    if (formData.prenom.length < 2) {
      showToast('Le prénom doit comporter au moins 2 caractères', 'error')
      return
    }
    if (formData.prenom.length > 50) {
      showToast('Le prénom ne peut pas dépasser 50 caractères', 'error')
      return
    }

    try {
      setIsSubmitting(true)
      await onSubmit(formData)
      showToast(initialData ? 'Client modifié avec succès' : 'Client enregistré avec succès', 'success')

      // Reset du formulaire seulement si on n'est pas en mode modification
      if (!initialData) {
        setFormData(EMPTY_CLIENT_FORM)
      }
    } catch (error) {
      console.error('Erreur formulaire client:', error)
      showToast(error.message || 'Impossible d’enregistrer le client', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClasses = "w-full rounded border border-line px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
  const inputEnDoublon = "w-full rounded border-2 border-warn/60 bg-warn-soft px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"

  /** « OUEDRAOGO SALIF · Code 0123456 · N° 01234567 · POUYTENGA » — de quoi reconnaître la fiche. */
  const ligneIdentite = (fiche) => [
    `${fiche?.nom ?? ''} ${fiche?.prenom ?? ''}`.trim() || '(sans nom)',
    libelleAgent(fiche),
    fiche?.localite,
  ].filter(Boolean).join(' · ')

  const formContent = (
    <>
      <form onSubmit={handleSubmit} className={embedded ? 'grid grid-cols-1 gap-x-7 gap-y-5 md:grid-cols-2' : 'space-y-4'}>
        <div>
          <label htmlFor="client-nom" className="block text-sm font-medium text-gray-700 mb-1">
            Nom <span className="text-danger" aria-hidden="true">*</span>
          </label>
          <input
            id="client-nom"
            type="text"
            name="nom"
            value={formData.nom}
            onChange={handleChange}
            className={inputClasses}
            required
          />
        </div>

        <div>
          <label htmlFor="client-prenom" className="block text-sm font-medium text-gray-700 mb-1">
            Prénom <span className="text-danger" aria-hidden="true">*</span>
          </label>
          <input
            id="client-prenom"
            type="text"
            name="prenom"
            value={formData.prenom}
            onChange={handleChange}
            className={inputClasses}
            required
          />
        </div>

        <div>
          <label htmlFor="client-identite" className="block text-sm font-medium text-gray-700 mb-1">
            Numéro d'identité
          </label>
          <input
            id="client-identite"
            type="text"
            name="numeroIdentite"
            value={formData.numeroIdentite}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="client-telephone" className="block text-sm font-medium text-gray-700 mb-1">
            Numéro personnel
          </label>
          <input
            id="client-telephone"
            type="text"
            name="numeroPersonnel"
            value={formData.numeroPersonnel}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="client-code-agent" className="block text-sm font-medium text-gray-700 mb-1">
            Code agent
          </label>
          <input
            id="client-code-agent"
            type="text"
            name="codeAgent"
            inputMode="numeric"
            value={formData.codeAgent}
            onChange={handleChange}
            className={doublonAgent?.champ === 'codeAgent' ? inputEnDoublon : inputClasses}
            aria-invalid={doublonAgent?.champ === 'codeAgent' || undefined}
            aria-describedby={doublonAgent ? 'client-doublon-agent' : undefined}
          />
        </div>

        <div>
          <label htmlFor="client-numero-agent" className="block text-sm font-medium text-gray-700 mb-1">
            Numéro agent
          </label>
          <input
            id="client-numero-agent"
            type="text"
            name="numeroAgent"
            inputMode="numeric"
            value={formData.numeroAgent}
            onChange={handleChange}
            className={doublonAgent?.champ === 'numeroAgent' ? inputEnDoublon : inputClasses}
            aria-invalid={doublonAgent?.champ === 'numeroAgent' || undefined}
            aria-describedby={doublonAgent ? 'client-doublon-agent' : undefined}
          />
        </div>

        {/* ⚠ L'AVERTISSEMENT OCCUPE LES DEUX COLONNES, juste sous les deux champs
            qu'il concerne. Relégué en bas près du bouton, il arrive après que le
            reste du formulaire a été rempli — c'est-à-dire trop tard pour servir. */}
        {doublonAgent && (
          <div
            id="client-doublon-agent"
            role="alert"
            className={`${embedded ? 'md:col-span-2' : ''} rounded border border-warn/40 bg-warn-soft p-3`}
          >
            <p className="text-sm font-semibold text-gray-900">
              {messageFicheExistante(doublonAgent.existant, storeIdCourant)}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {ligneIdentite(doublonAgent.existant)}
            </p>
            {onOuvrirFiche ? (
              <button
                type="button"
                onClick={() => onOuvrirFiche(doublonAgent.existant)}
                className="mt-2 rounded bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Ouvrir sa fiche pour la modifier
              </button>
            ) : (
              <p className="mt-2 text-sm text-gray-700">
                Ouvrir sa fiche depuis la liste des clients pour la modifier.
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="client-localite" className="block text-sm font-medium text-gray-700 mb-1">
            Localité
          </label>
          <input
            id="client-localite"
            type="text"
            name="localite"
            value={formData.localite}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label htmlFor="client-commercial" className="block text-sm font-medium text-gray-700 mb-1">
            Nom de l'agent commercial
          </label>
          <input
            id="client-commercial"
            type="text"
            name="agentCommercial"
            value={formData.agentCommercial}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || Boolean(doublonAgent)}
          className={`${embedded ? 'md:col-span-2 md:justify-self-end' : 'mt-6'} rounded bg-brand-500 px-6 py-2 font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`}
        >
          {isSubmitting ? 'Enregistrement...' : initialData ? 'Modifier' : 'Enregistrer'}
        </button>
      </form>

      {/* Toasts */}
      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </>
  )

  if (embedded) {
    return formContent
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 w-full">
      <PageHeader title={title} />
      {formContent}
    </div>
  )
}

export default ClientForm
