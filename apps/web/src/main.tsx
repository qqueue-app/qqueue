import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "./routes/AppRoutes.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { SessionProvider } from "./lib/session-context.js";
import { Toaster } from "./components/ui/sonner.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { createQueryClient } from "./lib/query-client.js";
import { registerServiceWorker } from "./lib/register-sw.js";
import { startDraftSync } from "./lib/offline-drafts.js";
import "./styles.css";

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/*
          delayDuration 300ms: long enough that tooltips don't flicker while a
          pointer crosses a toolbar, short enough to answer "what does this do?"
          skipDelayDuration keeps them instant once you're already reading one.
        */}
        <TooltipProvider delayDuration={300} skipDelayDuration={200}>
          <SessionProvider>
            <BrowserRouter>
              <AppRoutes />
              <Toaster />
            </BrowserRouter>
          </SessionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

registerServiceWorker();

// Outside React: a draft written on the compose screen has to reach the server
// even if the composer unmounted long before the network came back.
startDraftSync();
