import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Le Service Worker est automatiquement enregistré par vite-plugin-pwa
// via registerSW.js injecté dans index.html
