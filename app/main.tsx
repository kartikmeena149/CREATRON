import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useEditor } from "./store.ts";
import "./styles.css";

// Automated tests (app launched with --creatron-debug) read the editor state from here.
if (window.creatron.debug) Object.assign(window, { editor: useEditor });

createRoot(document.getElementById("root")!).render(<App />);
