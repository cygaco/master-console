#!/bin/sh
# CONTROL (not the proof): three consecutive in-suite runs at the fix head; restores the suite's known side effects between runs.
D=runtime/S-OS-06/r4/fixture-path
for i in 1 2 3; do
  node scripts/checks/run-tests.js > $D/control-run$i.txt 2>&1
  echo "run$i exit=$?" >> $D/control-summary.txt
  grep -E "^run-tests: (PASS|FAIL) — primary" $D/control-run$i.txt >> $D/control-summary.txt
  grep -c "migration.test.js" $D/control-run$i.txt | sed "s/^/run$i lines-mentioning-migration.test.js=/" >> $D/control-summary.txt
  git restore scripts/open-source/rename-mc.occurrences.json 2>/dev/null
  rm -rf runtime/S-OS-06/rename-occurrences.full.json runtime/S-OS-06/rename-plan.json
done
echo DONE >> $D/control-summary.txt
