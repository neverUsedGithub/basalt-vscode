/// <reference lib="DOM" />

import "./index.css";
import "@vscode/codicons/dist/codicon.css";

import { App } from "./app/App";
import { createRoot } from "react-dom/client";

createRoot(document.querySelector("#root")!).render(<App />);
