#!/bin/bash
set -e
npm install
printf '\n' | npm run db:push
# Wire git's hooks path to the in-repo `.husky/` directory so the
# pre-commit role-guard-coverage check runs locally before each commit.
# Idempotent — re-setting to the same value is a no-op.
git config core.hooksPath .husky
