#!/bin/bash
echo "Starting local backend server on port 8080..."
cd "$(dirname "$0")" || exit 1
node server.js
