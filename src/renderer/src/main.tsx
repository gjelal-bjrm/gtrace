import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Polices embarquées (licence libre OFL) : même rendu sur tous les PC, sans Internet.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import './shell.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
