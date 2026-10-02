import { useState, useEffect } from 'react'
import PageHeader from './ui/PageHeader'
import { useToast } from '../hooks/useToast'
import { getStorageKey } from '../config/clientIsolation'
import Toast from './Toast'

const EMPTY_CLIENT_FORM = {
  nom: '',
  prenom: '',
  numeroIdentite: '',
  numeroPersonnel: '',
  orange: '',
  moov: '',
  telecel: '',
  coris: '',
  sank: '',
  localite: '',
  agentCommercial: ''
}

const LEGACY_CLIENT_FORM_DRAFT_KEY = getStorageKey('client_form_draft')

function ClientForm({ onSubmit, initialData = null, title = 'Ajouter un client', embedded = false }) {
  const { toasts, showToast, removeToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState(EMPTY_CLIENT_FORM)

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
        orange: initialData.orange || '',
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    
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
          <label htmlFor="client-agent-orange" className="block text-sm font-medium text-gray-700 mb-1">
            Numéro agent / Code agent
          </label>
          <input
            id="client-agent-orange"
            type="text"
            name="orange"
            value={formData.orange}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

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
          disabled={isSubmitting}
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
