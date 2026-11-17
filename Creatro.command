#!/bin/bash
# Creatro: double-click this file to set Creatro up (the first time) and open it.
#
# Works from a git clone or a copied folder, on Apple Silicon and Intel Macs. What it adds stays in
# this folder (.runtime/, node_modules/, models/, out/); the only things installed on the Mac itself
# are the Homebrew tools (whisper-cpp, ffmpeg, yt-dlp), and it says so before it does.
#
#   ./Creatro.command           set up what's missing, then open the app
#   ./Creatro.command --check   only report what's there and what's missing; change nothing
set -u
cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
RUNTIME="$ROOT/.runtime"
NODE_VERSION="24.12.0"
WHISPER_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
WHISPER_SHA256="c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
# For every download: try again up to 10 times when the connection drops (HTTP/1.1, which drops less).
RETRY="--http1.1 --retry 10 --retry-delay 3 --retry-all-errors"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
fail() {
  printf '\n\033[31m%s\033[0m\n' "$*"
  [ -t 0 ] && read -r -p "Press Return to close." _
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "Creatro runs on macOS only."
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) fail "This Mac's chip ($ARCH) isn't supported." ;;
esac

# Apps and Homebrew live in a few usual places; the Node this script downloads comes first.
export PATH="$RUNTIME/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ $CHECK = 0 ] && mkdir -p "$RUNTIME"

printf '\033[1mCreatro\033[0m  (%s)\n' "$([ $CHECK = 1 ] && echo "check only, nothing is changed" || echo "first run sets things up, later runs just open it")"

# ---- 1. Node 24 -----------------------------------------------------------------------------
node_ok() {
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ -n "$major" ] && [ "$major" -ge 24 ]
}

say "1/5  Node"
if node_ok; then
  note "OK  Node $(node -v)"
elif [ $CHECK = 1 ]; then
  note "MISSING  would download Node $NODE_VERSION into .runtime/ (no password needed)"
else
  note "downloading Node $NODE_VERSION (about 50 MB) into .runtime/"
  name="node-v$NODE_VERSION-darwin-$NODE_ARCH"
  tmp="$(mktemp -d)"
  curl -fL $RETRY --progress-bar -o "$tmp/$name.tar.gz" "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" || fail "Couldn't download Node. Check the internet connection and run this again."
  curl -fsSL $RETRY -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" || fail "Couldn't download Node's checksums."
  (cd "$tmp" && grep " $name.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null) || fail "The Node download didn't match its checksum, so it wasn't used. Run this again."
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp" || fail "Couldn't unpack Node."
  rm -rf "$RUNTIME/node" && mv "$tmp/$name" "$RUNTIME/node"
  rm -rf "$tmp"
  node_ok || fail "Node was downloaded but doesn't start."
  note "OK  Node $(node -v)"
fi

# ---- 2. Creatro's packages --------------------------------------------------------------------
# Reinstalled when they're missing, built for the other chip (a folder copied from an M-series Mac
# to an Intel one), or installed from a different package-lock.json (after a git pull). The lock's
# fingerprint is kept in .runtime/; a copied folder without one is taken as it is.
LOCK_MARK="$RUNTIME/package-lock.sha256"
lock_sha() { shasum -a 256 "$ROOT/package-lock.json" | cut -d' ' -f1; }
packages_reason() {
  [ -x "$ELECTRON_BIN" ] || { echo "not installed yet"; return; }
  file "$ELECTRON_BIN" | grep -q "$ARCH" || { echo "they were built for another kind of Mac"; return; }
  [ -f "$LOCK_MARK" ] && [ "$(cat "$LOCK_MARK")" != "$(lock_sha)" ] && { echo "package-lock.json changed"; return; }
  echo ""
}

say "2/5  Creatro's packages"
reason="$(packages_reason)"
if [ -z "$reason" ]; then
  note "OK  installed"
  [ $CHECK = 0 ] && [ ! -f "$LOCK_MARK" ] && lock_sha >"$LOCK_MARK"
elif [ $CHECK = 1 ]; then
  note "NEEDED  would run npm ci ($reason; about 1 GB)"
else
  note "installing ($reason; about 1 GB, a few minutes)"
  rm -rf "$ROOT/node_modules"
  npm ci --no-audit --no-fund || fail "Installing the packages failed (see above). Run this again to retry."
  lock_sha >"$LOCK_MARK"
  note "OK  installed"
fi

# ---- 3. Tools from Homebrew -------------------------------------------------------------------
# whisper-cpp makes the transcript (captions, smart cuts). ffmpeg and yt-dlp are optional: without
# ffmpeg Creatro uses the one inside Remotion (no loudness levelling); without yt-dlp, no web video.
say "3/5  Tools (whisper-cpp, ffmpeg, yt-dlp)"
missing=""
command -v whisper-cli >/dev/null || missing="$missing whisper-cpp"
command -v ffmpeg >/dev/null || missing="$missing ffmpeg"
command -v yt-dlp >/dev/null || missing="$missing yt-dlp"
missing="${missing# }"

if [ -z "$missing" ]; then
  note "OK  all there"
elif [ $CHECK = 1 ]; then
  note "MISSING  $missing (would install with Homebrew$(command -v brew >/dev/null || echo ", after installing Homebrew"))"
else
  if ! command -v brew >/dev/null; then
    note "Missing: $missing. They come from Homebrew, which isn't on this Mac yet."
    note "Installing Homebrew asks for this Mac's password once."
    read -r -p "  Install Homebrew now? [Y/n] " answer
    case "$answer" in
      [nN]*) note "Skipped. Creatro still opens; without whisper-cpp there are no automatic captions." ;;
      *) /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || note "Homebrew didn't install; carrying on without it." ;;
    esac
  fi
  if command -v brew >/dev/null; then
    note "installing with Homebrew: $missing"
    # shellcheck disable=SC2086
    brew install $missing || note "Homebrew couldn't install everything (see above); Creatro uses its fallbacks for the rest."
  fi
  for t in whisper-cli ffmpeg yt-dlp; do
    command -v "$t" >/dev/null && note "OK  $t" || note "--  $t not installed"
  done
fi

# ---- 4. Whisper model -------------------------------------------------------------------------
# The same folders src/toolchain.ts looks in.
say "4/5  Speech model (Whisper)"
model=""
for d in "$ROOT/models" "$HOME/.cache/hyperframes/whisper/models" "$HOME/.cache/whisper.cpp" "/opt/homebrew/share/whisper-cpp"; do
  for f in "$d"/ggml-*.bin; do
    [ -f "$f" ] && { model="$f"; break 2; }
  done
done

if [ -n "$model" ]; then
  note "OK  ${model/#$HOME/~}"
elif [ $CHECK = 1 ]; then
  note "MISSING  would download ggml-small.en.bin (466 MB) into models/"
else
  note "downloading ggml-small.en.bin (466 MB) into models/"
  mkdir -p "$ROOT/models"
  part="$ROOT/models/ggml-small.en.bin.part"
  # Hugging Face's servers sometimes drop a long download midway; each retry resumes where it stopped.
  curl -fL -C - $RETRY --progress-bar -o "$part" "$WHISPER_URL" || fail "Couldn't download the speech model. Run this again; it resumes."
  if [ "$(shasum -a 256 "$part" | cut -d' ' -f1)" = "$WHISPER_SHA256" ]; then
    mv "$part" "$ROOT/models/ggml-small.en.bin"
    note "OK  models/ggml-small.en.bin"
  else
    rm -f "$part"
    fail "The speech model didn't match its checksum, so it was deleted. Run this again."
  fi
fi

# ---- 5. Build the app -------------------------------------------------------------------------
say "5/5  App build"
built="$ROOT/out/main/main.js"
if [ -f "$built" ] && [ -z "$(find "$ROOT/app" "$ROOT/electron" "$ROOT/src" -type f -newer "$built" 2>/dev/null | head -1)" ]; then
  note "OK  up to date"
elif [ $CHECK = 1 ]; then
  note "NEEDED  would run npm run build"
else
  npm run build >"$RUNTIME/build.log" 2>&1 || { tail -20 "$RUNTIME/build.log"; fail "The build failed (full log: .runtime/build.log)."; }
  note "OK  built"
fi

# ---- Open -------------------------------------------------------------------------------------
if [ ! -f "$ROOT/.env" ] || ! grep -q '^OPENROUTER_API_KEY=.' "$ROOT/.env"; then
  say "Before your first edit"
  note "Add an OpenRouter key in Creatro: Connections (left sidebar). Get one at openrouter.ai/keys."
fi

if [ $CHECK = 1 ]; then
  say "Check done. Nothing was changed."
  exit 0
fi

# A folder that came by AirDrop or a downloaded zip is marked as "from the internet"; macOS then
# refuses to open the Electron app inside it. This folder was opened on purpose, so clear the mark.
xattr -dr com.apple.quarantine "$ROOT/node_modules/electron/dist/Electron.app" 2>/dev/null

say "Opening Creatro"
nohup "$ELECTRON_BIN" "$ROOT" >"$RUNTIME/app.log" 2>&1 &
disown
note "You can close this window. Next time, double-click Creatro.command again: it just opens the app."
