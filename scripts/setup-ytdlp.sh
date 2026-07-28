#!/bin/bash
# Setup script for yt-dlp audio extraction (Musical feature)
#
# YouTube has aggressive anti-bot measures in 2026. This script installs
# everything needed to reliably extract audio:
#   - yt-dlp (latest version)
#   - Deno (JS runtime for n-challenge solving)
#   - yt-dlp-ejs (EJS challenge solver)
#   - bgutil-ytdlp-pot-provider (PO Token generator)
#   - ffmpeg (audio conversion)
#
# Run this on your server:
#   chmod +x scripts/setup-ytdlp.sh
#   ./scripts/setup-ytdlp.sh

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          yt-dlp Setup for Musical Feature                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check if running as root
if [ -n "$VIRTUAL_ENV" ] || [ "$EUID" -eq 0 ]; then
  PIP="pip3"
else
  PIP="pip3 --user"
fi

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

# 2. Install/update yt-dlp
echo "📦 Updating yt-dlp..."
$PIP install -U yt-dlp
echo "✅ yt-dlp updated"
echo ""

# 3. Install yt-dlp-ejs (EJS challenge solver)
echo "📦 Installing yt-dlp-ejs (required for YouTube n-challenge)..."
$PIP install -U yt-dlp-ejs
echo "✅ yt-dlp-ejs installed"
echo ""

# 4. Install PO Token provider
echo "📦 Installing bgutil-ytdlp-pot-provider (PO Token generator)..."
$PIP install -U bgutil-ytdlp-pot-provider
echo "✅ PO Token provider installed"
echo ""

# 5. Install Deno (JS runtime)
echo "📦 Installing Deno (required for signature extraction)..."
if ! command -v deno &> /dev/null; then
  curl -fsSL https://deno.land/install.sh | sh
  # Add to PATH for this session
  export DENO_INSTALL="$HOME/.deno"
  export PATH="$DENO_INSTALL/bin:$PATH"
  echo ""
  echo "⚠️  Deno installed to ~/.deno/bin/deno"
  echo "   Add this to your shell profile (~/.bashrc or ~/.zshrc):"
  echo "   export DENO_INSTALL=\"\$HOME/.deno\""
  echo "   export PATH=\"\$DENO_INSTALL/bin:\$PATH\""
else
  echo "✅ Deno already installed: $(deno --version)"
fi
echo ""

# 6. Verify installation
echo "🔍 Verifying installation..."
echo ""
echo "yt-dlp version:"
yt-dlp --version 2>/dev/null || echo "❌ yt-dlp not found in PATH"
echo ""
echo "Deno version:"
deno --version 2>/dev/null || echo "❌ Deno not found in PATH"
echo ""
echo "ffmpeg version:"
ffmpeg -version 2>/dev/null | head -1 || echo "❌ ffmpeg not found in PATH"
echo ""

# 7. Test with a known video
echo "🧪 Testing audio extraction with a sample video..."
TEST_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
TEMP_FILE="/tmp/adoo_test.mp3"
yt-dlp -f "ba/b" -x --audio-format mp3 --audio-quality 5 \
  --no-playlist --no-warnings --no-progress \
  -o "$TEMP_FILE" \
  "$TEST_URL" 2>&1 && \
  echo "✅ Test successful! Audio extracted to $TEMP_FILE ($(du -h $TEMP_FILE | cut -f1))" || \
  echo "❌ Test failed. Check the error above."

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Export cookies from your browser (use 'Get cookies.txt' extension)"
echo "   while logged into YouTube"
echo "2. Save as cookies.txt in your project root"
echo "3. Add to .env: YTDLP_COOKIES_PATH=./cookies.txt"
echo "4. Restart the app"
echo ""
echo "If you still get 'Requested format is not available' errors:"
echo "  - Make sure Deno is in PATH: which deno"
echo "  - Update yt-dlp: pip install -U yt-dlp"
echo "  - Run: yt-dlp -vU 'https://www.youtube.com/watch?v=VIDEO_ID'"
echo "    and check for 'n challenge solving failed' in the output"
echo "═══════════════════════════════════════════════════════════"
