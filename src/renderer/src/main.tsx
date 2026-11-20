import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installGlobalErrorHandlers } from './shared/diagnostics'
import { ErrorBoundary } from './shared/ErrorBoundary'

// Error tracing: what nothing else catches (an uncaught error, an unhandled rejection) is logged.
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary label="OmicExplorer" where="render-app" variant="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
