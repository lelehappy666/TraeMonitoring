import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { ActiveDaysWindow } from './components/ActiveDaysWindow'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.hash === '#active' ? <ActiveDaysWindow /> : <App />}
  </StrictMode>,
)
