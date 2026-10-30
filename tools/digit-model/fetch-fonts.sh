#!/usr/bin/env bash
# Downloads the open-licensed (OFL) Arabic fonts used to render training images, from the npm
# @fontsource packages, into ./fonts (not committed). Fonts with Latin-only digits are skipped.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in noto-naskh-arabic noto-sans-arabic noto-kufi-arabic amiri cairo tajawal almarai scheherazade-new lateef \
         harmattan markazi-text reem-kufi el-messiri changa mada readex-pro alexandria lemonada baloo-bhaijaan-2 \
         kufam ibm-plex-sans-arabic rubik vazirmatn mirza; do
  (cd "$tmp" && npm pack -q "@fontsource/$f" >/dev/null)
  mkdir -p "$tmp/$f" && tar -xzf "$tmp"/fontsource-"$f"-*.tgz -C "$tmp/$f"
  for w in 400 700; do
    src=$(ls "$tmp/$f"/package/files/*-arabic-$w-normal.woff 2>/dev/null | head -1 || true)
    [ -n "$src" ] && cp "$src" "fonts/${f%-2}-$w.woff"
  done
done
ls fonts | wc -l
