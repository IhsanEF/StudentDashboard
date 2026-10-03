/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { logout } from "./auth";
import { initGlobalErrorMonitoring } from "./services/errorReporter";
import "./index.css";

// Global error handlers for resilience and production observability
initGlobalErrorMonitoring();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Dashboard Encountered an Error" onSignOut={() => { void logout().then(() => window.location.reload()); }}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

