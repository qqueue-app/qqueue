import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./routes/AppRoutes.js";
import { SessionProvider } from "./lib/session-context.js";
import { ThemeProvider } from "./lib/theme.js";
import { Toaster } from "./components/ui/sonner.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster />
        </BrowserRouter>
      </SessionProvider>
    </ThemeProvider>
  </React.StrictMode>
);
