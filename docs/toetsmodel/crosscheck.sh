#!/usr/bin/env bash
# Kruiscontrole op willekeurige dossiers: app-engine (Vitest) tegen de Excel-formules (LibreOffice).
# Gebruik (vanuit de repo-root):  docs/toetsmodel/crosscheck.sh [aantal] [seed]
set -euo pipefail
N="${1:-150}"; SEED="${2:-7}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; D="$ROOT/docs/toetsmodel"
T="$(mktemp -d)"
python3 "$D/make_random_scenarios.py" "$N" "$SEED" "$T/scen.json"
(cd "$ROOT" && SCENARIOS_FILE="$T/scen.json" EXPECTED_FILE="$T/exp.json" UPDATE_EXPECTED=1 npx vitest run src/toetsmodel.test.js >/dev/null)
python3 "$D/build_toetsmodel.py" "$T/scen.json" "$T/exp.json" "$T/fuzz.xlsx" >/dev/null
RECALC="${RECALC:-$(ls /root/.claude/skills/synced/*/xlsx/scripts/recalc.py 2>/dev/null | head -1)}"
python3 "$RECALC" "$T/fuzz.xlsx" 600 | grep -E '"status"|total_errors'
python3 "$D/verify_toetsmodel.py" "$T/fuzz.xlsx" "$T/fuzz.layout.json" "$T/exp.json" "$T/scen.json"
