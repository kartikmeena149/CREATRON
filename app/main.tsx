import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useEditor } from "./store.ts";
import "./styles.css";
import { loadBundledFonts } from "../motion/fonts.ts";

// Creatron's own caption fonts, so the preview and the font list show them.
loadBundledFonts();

// Automated tests (app launched with --creatron-debug) read the editor state from here.
if (window.creatron.debug) Object.assign(window, { editor: useEditor });

createRoot(document.getElementById("root")!).render(<App />);
