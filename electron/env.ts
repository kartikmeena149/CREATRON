// Runs before the engine modules load (imports evaluate in order), so they see these values.
import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

process.env.CREATRON_ROOT = app.getAppPath();
// Apps opened from Finder don't get the shell's PATH; ffmpeg and whisper live in Homebrew.
process.env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].join(":");
const envFile = join(app.getAppPath(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
