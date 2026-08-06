import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./routes/AppRoutes.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { SessionProvider } from "./lib/session-context.js";
import { Toaster } from "./components/ui/sonner.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster />
        </BrowserRouter>
      </SessionProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
