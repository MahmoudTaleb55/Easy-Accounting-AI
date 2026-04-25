#!/bin/bash
set -e
npm install
printf '\n' | npm run db:push
