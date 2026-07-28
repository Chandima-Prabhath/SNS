#!/bin/bash
# Setup script for yt-dlp audio extraction (Musical feature)
#
# YouTube has aggressive anti-bot measures in 2026. This script installs
# everything needed to reliably extract audio:
#   - yt-dlp (latest version, with [default] extras for EJS)
#   - Deno (JS runtime for n-challenge solving)
#   - yt-dlp-ejs (EJS challenge solver)
#   - bgutil-ytdlp-pot-provider (PO Token generator)
#   - ffmpeg (audio conversion)
#
# CRITICAL: The "Sign in to confirm you're not a bot" error is NOT a cookies
# problem — it's caused by missing Deno + yt-dlp-ejs. YouTube serves JS
# challenges that yt-dlp must execute. Without a JS runtime, yt-dlp cannot
# solve them and reports the failure as a bot detection error.
#
# Run this on your server:
#   chmod +x scripts/setup-ytdlp.sh
#   ./scripts/setup-ytdlp.sh

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          yt-dlp Setup for Musical Feature                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 1. Install ffmpeg
echo "📦 Installing ffmpeg..."
if command -v apt &> /dev/null; then
  sudo apt update -qq && sudo apt install -y -qq ffmpeg
elif command -v yum &> /dev/null; then
  sudo yum install -y ffmpeg
elif command -v brew &> /dev/null; then
  brew install ffmpeg
else
  echo "⚠️  Could not detect package manager. Install ffmpeg manually."
fi
echo "✅ ffmpeg installed"
echo ""

# 2. Install/update yt-dlp with [default] extras (includes yt-dlp-ejs)
echo "📦 Installing yt-dlp with EJS challenge solver..."
pip3 install -U "yt-dlp[default]"
echo "✅ yt-dlp + yt-dlp-ejs installed"
echo ""

# 3. Install PO Token provider
echo "📦 Installing bgutil-ytdlp-pot-provider (PO Token generator)..."
pip3 install -U bgutil-ytdlp-pot-provider
echo "✅ PO Token provider installed"
echo ""

# 4. Install Deno (JS runtime — CRITICAL for n-challenge solving)
echo "📦 Installing Deno (required for YouTube signature extraction)..."
if ! command -v deno &> /dev/null; then
  curl -fsSL https://deno.land/install.sh | sh
  # Add to PATH for this session
  export DENO_INSTALL="$HOME/.deno"
  export PATH="$DENO_INSTALL/bin:$PATH"

  # Add to shell profile if not already there
  if ! grep -q "DENO_INSTALL" "$HOME/.bashrc" 2>/dev/null; then
    echo '' >> "$HOME/.bashrc"
    echo '# Deno' >> "$HOME/.bashrc"
    echo 'export DENO_INSTALL="$HOME/.deno"' >> "$HOME/.bashrc"
    echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> "$HOME/.bashrc"
    echo "✅ Added Deno to ~/.bashrc"
  fi
else
  echo "✅ Deno already installed: $(deno --version 2>/dev/null | head -1)"
fi
echo ""

# 5. Start PO Token provider HTTP server (background)
echo "📦 Starting PO Token provider HTTP server..."
if ! curl -s http://127.0.0.1:4416/health > /dev/null 2>&1; then
  # Try to start it in the background
  nohup python3 -m bgutil_ytdlp_pot_provider --port 4416 > /tmp/pot-provider.log 2>&1 &
  echo "✅ PO Token provider started on port 4416"
  echo "   Log: /tmp/pot-provider.log"
  echo "   To stop: kill \$(lsof -ti:4416)"
else
  echo "✅ PO Token provider already running on port 4416"
fi
echo ""

# 6. Verify installation
echo "🔍 Verifying installation..."
echo ""
echo "yt-dlp version:"
yt-dlp --version 2>/dev/null || python3 -m yt_dlp --version 2>/dev/null || echo "❌ yt-dlp not found in PATH"
echo ""

echo "Deno version:"
if command -v deno &> /dev/null; then
  deno --version 2>/dev/null | head -1
else
  if [ -f "$HOME/.deno/bin/deno" ]; then
    $HOME/.deno/bin/deno --version 2>/dev/null | head -1
    echo "⚠️  Deno installed but not in current PATH. Run: source ~/.bashrc"
  else
    echo "❌ Deno not found"
  fi
fi
echo ""

echo "ffmpeg version:"
ffmpeg -version 2>/dev/null | head -1 || echo "❌ ffmpeg not found in PATH"
echo ""

echo "PO Token provider:"
if curl -s http://127.0.0.1:4416/health > /dev/null 2>&1; then
  echo "✅ Running on port 4416"
else
  echo "⚠️  Not running. Start with: nohup python3 -m bgutil_ytdlp_pot_provider --port 4416 &"
fi
echo ""

# 7. Test with a known video
echo "🧪 Testing audio extraction..."
TEST_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
TEMP_FILE="/tmp/adoo_test.mp3"

# Make sure deno is in PATH for the test
export PATH="$HOME/.deno/bin:$PATH"

yt-dlp -f "ba/b" -x --audio-format mp3 --audio-quality 5 \
  --no-playlist --no-warnings --no-progress \
  --retries 3 --fragment-retries 3 \
  -o "$TEMP_FILE" \
  "$TEST_URL" 2>&1 && \
  echo "✅ Test successful! Audio extracted: $(du -h $TEMP_FILE 2>/dev/null | cut -f1 || echo 'file created')" || \
  echo "❌ Test failed. Check the error above."

# Also check verbose output for diagnostics
echo ""
echo "🔍 Diagnostics — checking for common issues..."
yt-dlp -v "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | grep -E "(JS runtimes|JS Challenge|PO Token|EJS|n challenge|optional libraries)" | head -10

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Setup complete!"
echo ""
echo "If you still get 'Sign in to confirm you're not a bot':"
echo "  1. Make sure Deno is in PATH: source ~/.bashrc && which deno"
echo "  2. Check verbose output: yt-dlp -v 'URL' 2>&1 | grep 'JS runtimes'"
echo "     If it says 'JS runtimes: none', Deno is not in PATH"
echo "  3. Re-export cookies from a PRIVATE browser window:"
echo "     - Open private/incognito window"
echo "     - Log into YouTube"
echo "     - Navigate to https://www.youtube.com/robots.txt"
echo "     - Export cookies with 'Get cookies.txt LOCALLY' extension"
echo "     - Close the private window immediately"
echo "  4. Set YTDLP_COOKIES_PATH=./cookies.txt in .env"
echo "  5. Restart the app"
echo "═══════════════════════════════════════════════════════════"
