#!/bin/bash
echo "Starting local backend server on port 8080..."
cd "$(dirname "$0")/.." || exit 1
python3 -m http.server 8080
