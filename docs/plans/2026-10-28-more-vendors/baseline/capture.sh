#!/usr/bin/env bash
# Usage: capture.sh <out-dir> <engine-url> <fixtures-origin> <site>...
# Runs `capture <origin>/<site>/<page> --scenario all --rules --block-vendors` for / and /thank-you
# and keeps only the status lines: engine, consent outcome and "<scenario> <status> <rule>".
# No hit values, messages or evidence are written.
set -u
out=$1 engine=$2 origin=$3
shift 3
cli="$(cd "$(dirname "$0")/../../../.." && pwd)/apps/cli/dist/index.js"
mkdir -p "$out"
for site in "$@"; do
  for page in "" thank-you; do
    name="${site}__${page:-home}.txt"
    raw=$(mktemp)
    # one capture at a time per engine: retry while it answers busy (429)
    for _ in $(seq 60); do
      node "$cli" capture "$origin/$site/$page" --scenario all --rules --block-vendors --engine "$engine" >| "$raw" 2>&1
      grep -q "(429)" "$raw" || break
      sleep 5
    done
    awk '
        /^== /          { match($0, /\[[a-z]+\]/); scen = substr($0, RSTART + 1, RLENGTH - 2); sect = ""; next }
        /^engine: /     { print scen "\tengine\t" $2; next }
        /^consent: /    { sub(/,.*/, "", $0); print scen "\tconsent\t" $2; next }
        /^checks /      { sect = "checks"; next }
        /^page: /       { print scen "\tpage\t" $2 " " $3; next }
        /^[a-z]/        { if ($0 !~ /^(engine|consent|checks|page)/) sect = $1; next }
        sect == "checks" && NF >= 2 && $2 ~ /\./ { print scen "\t" $1 "\t" $2 }
      ' "$raw" >| "$out/$name"
    rm -f "$raw"
  done
done
