import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GameProvider } from "./context/GameContext";
import App from "./App";
import "./styles.css";
import "./layout.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <GameProvider>
        <App />
      </GameProvider>
    </BrowserRouter>
  </React.StrictMode>
);

import "./anime.css";

import "./lobby-v2.css";
import "./stability.css";
import "./concentrated.css";
import "./round6.css";
import "./round7.css";
import "./round8.css";

import "./round9.css";
import "./round10.css";
import "./round10-feedback.css";

import './staged-draft.css';
import './round11-ux.css';
