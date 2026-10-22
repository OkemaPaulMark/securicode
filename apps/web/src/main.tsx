import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/schibsted-grotesk/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
