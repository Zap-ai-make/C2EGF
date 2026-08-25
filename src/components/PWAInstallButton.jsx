import { useState, useEffect } from 'react'

function isRunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// Instructions manuelles pour les navigateurs sans beforeinstallprompt (Firefox, Safari iOS)
function getBrowserHint() {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua)) {
    return "Sur Safari : appuyez sur le bouton Partager ↑, puis « Sur l'écran d'accueil »"
  }
  if (/Firefox/.test(ua)) {
    return 'Sur Firefox : ouvrez le menu (≡) en bas, puis appuyez sur « Installer »'
  }
  return null
}

const PWAInstallButton = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(
    () => window.__pwaInstallEvent ?? null
  )
  const [nativeAvailable, setNativeAvailable] = useState(
    () => !isRunningStandalone() && window.__pwaInstallEvent != null
  )
  const [hintVisible, setHintVisible] = useState(false)

  const standalone = isRunningStandalone()
  const browserHint = getBrowserHint()

  useEffect(() => {
    if (standalone) return
    const onAvailable = () => {
      setDeferredPrompt(window.__pwaInstallEvent)
      setNativeAvailable(true)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setNativeAvailable(false)
    }
    window.addEventListener('pwa-install-available', onAvailable)
    window.addEventListener('pwa-installed', onInstalled)
    return () => {
      window.removeEventListener('pwa-install-available', onAvailable)
      window.removeEventListener('pwa-installed', onInstalled)
    }
  }, [standalone])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      window.__pwaInstallEvent = null
      setDeferredPrompt(null)
      setNativeAvailable(false)
      return
    }
    setHintVisible(v => !v)
  }

  if (standalone) return null
  if (!nativeAvailable && !browserHint) return null

  return (
    <div className="relative">
      <button
        onClick={handleInstall}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200 flex items-center gap-2"
        title="Installer l'application"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Installer l'app
      </button>
      {hintVisible && browserHint && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-gray-900 text-white text-sm rounded-xl p-4 shadow-2xl z-50 leading-relaxed border border-gray-700">
          {browserHint}
        </div>
      )}
    </div>
  )
}

export default PWAInstallButton
