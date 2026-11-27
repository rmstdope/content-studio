#!/usr/bin/env bash
# Puts the pinned ffmpeg and ffprobe CI tests with in <directory>, and on the path of the job's
# later steps. The workflow restores <directory> from the Actions cache, keyed on this file, so the
# download happens only when the cache is empty.
#
# The pin is one of BtbN/FFmpeg-Builds' end-of-month releases, which are kept for two years. The
# shared build is half the download of the static one and finds its libraries in ../lib by itself.
# To move it, change both lines below; FFMPEG_URL and FFMPEG_SHA256 replace them for the tests.
set -euo pipefail

url="${FFMPEG_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-shared-8.1.tar.xz}"
sha256="${FFMPEG_SHA256:-202fe67679a0860b155817a0907ffcc5c1ea82e186acaa21cb87d307f54fd59a}"
dir="${1:?usage: ci-ffmpeg.sh <directory>}"

if [ ! -x "$dir/bin/ffmpeg" ] || [ ! -x "$dir/bin/ffprobe" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSL --retry 3 -o "$work/ffmpeg.tar.xz" "$url"
  echo "$sha256  $work/ffmpeg.tar.xz" | shasum -a 256 -c -
  mkdir "$work/build"
  tar -xf "$work/ffmpeg.tar.xz" -C "$work/build" --strip-components=1
  rm -f "$work/build/bin/ffplay"
  mkdir -p "$dir"
  cp -R "$work/build/bin" "$work/build/lib" "$dir/"
fi

# A binary that does not run fails the job here: the tests that need it would skip, not fail.
for program in ffmpeg ffprobe; do
  version="$("$dir/bin/$program" -version)"
  echo "${version%%$'\n'*}"
done

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$dir/bin" >>"$GITHUB_PATH"
fi
