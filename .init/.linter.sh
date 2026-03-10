#!/bin/bash
cd /home/kavia/workspace/code-generation/responsive-drawing-studio-330726-330740/drawing_app_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

