import { useState, useEffect } from 'react'
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

const CLIENT_FORM_DRAFT_KEY = getStorageKey('client_form_draft')

const readClientFormDraft = () => {
  if (typeof window === 'undefined') return EMPTY_CLIENT_FORM

  try {
    const draft = window.localStorage.getItem(CLIENT_FORM_DRAFT_KEY)
    return draft ? { ...EMPTY_CLIENT_FORM, ...JSON.parse(draft) } : EMPTY_CLIENT_FORM
  } catch {
    return EMPTY_CLIENT_FORM
  }
}

const hasFormDraft = (data) => Object.values(data).some(value => String(value || '').trim())

function ClientForm({ onSubmit, initialData = null, title = 'Ajouter un client' }) {
  const { toasts, showToast, removeToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState(() => initialData ? EMPTY_CLIENT_FORM : readClientFormDraft())

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

  useEffect(() => {
    if (initialData || typeof window === 'undefined') return

    try {
      if (hasFormDraft(formData)) {
        window.localStorage.setItem(CLIENT_FORM_DRAFT_KEY, JSON.stringify(formData))
      } else {
        window.localStorage.removeItem(CLIENT_FORM_DRAFT_KEY)
      }
    } catch {
      // Le brouillon est une aide UX; l'enregistrement principal reste prioritaire.
    }
  }, [formData, initialData])

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
        window.localStorage.removeItem(CLIENT_FORM_DRAFT_KEY)
        setFormData(EMPTY_CLIENT_FORM)
      }
    } catch (error) {
      console.error('Erreur formulaire client:', error)
      showToast(error.message || 'Impossible d’enregistrer le client', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500"

  return (
    <div className="bg-white rounded-lg shadow-md p-6 w-full">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b-2 border-green-500 pb-2">
        {title}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom
          </label>
          <input
            type="text"
            name="nom"
            value={formData.nom}
            onChange={handleChange}
            className={inputClasses}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Prénom
          </label>
          <input
            type="text"
            name="prenom"
            value={formData.prenom}
            onChange={handleChange}
            className={inputClasses}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Numéro d'identité
          </label>
          <input
            type="text"
            name="numeroIdentite"
            value={formData.numeroIdentite}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Numéro personnel
          </label>
          <input
            type="text"
            name="numeroPersonnel"
            value={formData.numeroPersonnel}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Numéro agent / Code agent
          </label>
          <input
            type="text"
            name="orange"
            value={formData.orange}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Localité
          </label>
          <input
            type="text"
            name="localite"
            value={formData.localite}
            onChange={handleChange}
            className={inputClasses}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom de l'agent commercial
          </label>
          <input
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
          className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium py-2 px-6 rounded mt-6"
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
    </div>
  )
}

export default ClientForm
