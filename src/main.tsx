import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./contexts/ToastContext";
import { PrefsProvider } from "./contexts/PrefsContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <PrefsProvider>
          <App />
        </PrefsProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
