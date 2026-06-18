import "@fontsource-variable/noto-sans";
import "@fontsource-variable/playfair-display";
import "@mysten/dapp-kit/dist/index.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root container not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
