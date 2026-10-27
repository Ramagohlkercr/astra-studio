#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/Users/ramirogohlke/.gemini/antigravity/scratch/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "=========================================================="
echo "  Iniciando LaserHouse Studio en macOS Apple Silicon..."
echo "  Abra en su navegador: http://localhost:5173"
echo "=========================================================="
npm run dev
