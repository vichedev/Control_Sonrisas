import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconContext } from '@phosphor-icons/react'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'

// Valores por defecto de los iconos Phosphor (el tamaño real lo dan las clases w-/h-).
const ICON_DEFAULTS = { weight: 'regular', size: '1em', mirrored: false }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IconContext.Provider value={ICON_DEFAULTS}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
)
