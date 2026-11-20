/**
 * Le signal à Oxygen quand une demande se ferme (contrat demande-operation v9,
 * §10). Le CRM prévient le serveur Oxygen, qui réveille le téléphone de
 * l'agent ; le signal ne porte que l'identifiant, l'app relit l'état chez nous
 * par `etatDemande`, qui seul fait foi.
 *
 * L'identité est celle du compte de service sous lequel tourne la function :
 * un jeton d'identité Google pris au serveur de métadonnées, avec l'URL même
 * pour audience. C'est ce que fait `getIdTokenClient` de google-auth-library,
 * sans dépendre d'une librairie que seul firebase-admin apporte.
 */

export const URL_SIGNAL = 'https://flwbscqezuhmshjnrakr.supabase.co/functions/v1/liaison'
export const DELAI_SIGNAL_MS = 3000

const METADONNEES = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'

function echec(etape, status) {
  return Object.assign(new Error(`Signal Oxygen : ${etape} ${status}`), { statut: status })
}

/**
 * Un seul appel, jamais rejoué, `delaiMs` en tout, jeton compris. Lève quand
 * le jeton ou l'envoi échoue ; c'est à l'appelant de ne pas en souffrir.
 * Sur un projet `demo-*` (émulateurs, tests), rien ne part.
 */
export async function signalerDemandeFermee(demandeId, { fetch = globalThis.fetch, projet = process.env.GCLOUD_PROJECT, delaiMs = DELAI_SIGNAL_MS } = {}) {
  if (String(projet || '').startsWith('demo-')) return
  const signal = AbortSignal.timeout(delaiMs)

  const reponseJeton = await fetch(`${METADONNEES}?format=full&audience=${encodeURIComponent(URL_SIGNAL)}`, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal,
  })
  if (!reponseJeton.ok) throw echec('jeton', reponseJeton.status)
  const jeton = await reponseJeton.text()

  const reponse = await fetch(URL_SIGNAL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signal', demande: demandeId }),
    signal,
  })
  if (!reponse.ok) throw echec('envoi', reponse.status)
}
