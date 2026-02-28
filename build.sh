#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${ROOT_DIR}/dist"

FIREFOX_DIR="${DIST_DIR}/firefox"
CHROME_DIR="${DIST_DIR}/chrome"

FIREFOX_MANIFEST="${ROOT_DIR}/manifest.json"
CHROME_MANIFEST="${ROOT_DIR}/manifest.chromium.json"

if [[ ! -f "${FIREFOX_MANIFEST}" ]]; then
  echo "Missing Firefox manifest: ${FIREFOX_MANIFEST}" >&2
  exit 1
fi

if [[ ! -f "${CHROME_MANIFEST}" ]]; then
  echo "Missing Chromium manifest: ${CHROME_MANIFEST}" >&2
  exit 1
fi

copy_common_files() {
  local target_dir="$1"

  rm -rf "${target_dir}"
  mkdir -p "${target_dir}"

  local item
  for item in "${ROOT_DIR}"/*; do
    local base
    base="$(basename "${item}")"

    case "${base}" in
      dist|build.sh|manifest.json|manifest.chromium.json)
        continue
        ;;
    esac

    cp -R "${item}" "${target_dir}/"
  done
}

echo "Building Firefox distributable directory..."
copy_common_files "${FIREFOX_DIR}"
cp "${FIREFOX_MANIFEST}" "${FIREFOX_DIR}/manifest.json"

echo "Building Chrome distributable directory..."
copy_common_files "${CHROME_DIR}"
cp "${CHROME_MANIFEST}" "${CHROME_DIR}/manifest.json"

echo "Creating browser package archives..."
(
  cd "${DIST_DIR}"
  rm -f firefox.zip firefox.xpi chrome.zip

  # Firefox expects extension files at archive root.
  (
    cd firefox
    zip -qr ../firefox.xpi .
  )

  # Keep a Chromium zip artifact for distribution.
  (
    cd chrome
    zip -qr ../chrome.zip .
  )
)

echo
echo "Build complete:"
echo "  - ${FIREFOX_DIR}"
echo "  - ${CHROME_DIR}"
echo "  - ${DIST_DIR}/firefox.xpi"
echo "  - ${DIST_DIR}/chrome.zip"
