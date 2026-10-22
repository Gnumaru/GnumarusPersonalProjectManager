#!/usr/bin/env bash
#
# End to end smoke test: serves the built application with a static server and
# renders it with headless Chrome, at the domain root and at a nested path.
#
set -euo pipefail

cd "$(dirname "$0")/.."

ROOT_DIR="$(pwd)"
TMP_DIR="${ROOT_DIR}/tmp/e2e"
SERVE_DIR="${TMP_DIR}/www"
CHROME_BIN="${CHROME_BIN:-/opt/google/chrome/chrome}"
PORT="${E2E_PORT:-8931}"

if [ ! -d "${ROOT_DIR}/dist" ]; then
  echo "==> building the application first"
  npm run build
fi

rm -rf "${TMP_DIR}"
mkdir -p "${SERVE_DIR}/nested/deep/app"
cp -r "${ROOT_DIR}/dist/." "${SERVE_DIR}/"
cp -r "${ROOT_DIR}/dist/." "${SERVE_DIR}/nested/deep/app/"

if [ ! -x "${CHROME_BIN}" ]; then
  echo "Chrome was not found at ${CHROME_BIN}, skipping the browser test."
  exit 0
fi

python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${SERVE_DIR}" >"${TMP_DIR}/server.log" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" 2>/dev/null || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  echo "The static server did not start, see ${TMP_DIR}/server.log"
  exit 1
fi

render() {
  local url="$1"
  local output="$2"
  "${CHROME_BIN}" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --hide-scrollbars \
    --user-data-dir="${TMP_DIR}/chrome-profile" \
    --virtual-time-budget=8000 \
    --window-size=1366,768 \
    --dump-dom "${url}" >"${output}" 2>"${TMP_DIR}/chrome.log"
}

expect_marker() {
  local file="$1"
  local marker="$2"
  local label="$3"
  if ! grep -qF "${marker}" "${file}"; then
    echo "FAIL: ${label} does not contain '${marker}'"
    echo "--- first 40 lines of the rendered DOM ---"
    head -c 2000 "${file}"
    echo
    exit 1
  fi
  echo "ok: ${label} contains '${marker}'"
}

# The state of the service depends on the kind of storage the browser chose:
# the pill holds "Service online", "Service not needed" or "Service
# unavailable". The marker "Service" is always there.
echo "==> rendering the application at the domain root"
render "http://127.0.0.1:${PORT}/" "${TMP_DIR}/root.html"
expect_marker "${TMP_DIR}/root.html" "Gnumarus Project Manager" "the root page"
expect_marker "${TMP_DIR}/root.html" "Service" "the root page"
expect_marker "${TMP_DIR}/root.html" "New task" "the root page"
expect_marker "${TMP_DIR}/root.html" "Tree" "the root page"
expect_marker "${TMP_DIR}/root.html" "Notes" "the root page"

echo "==> rendering the application at a nested path"
render "http://127.0.0.1:${PORT}/nested/deep/app/" "${TMP_DIR}/nested.html"
expect_marker "${TMP_DIR}/nested.html" "Gnumarus Project Manager" "the nested page"
expect_marker "${TMP_DIR}/nested.html" "Service" "the nested page"
expect_marker "${TMP_DIR}/nested.html" "New task" "the nested page"
expect_marker "${TMP_DIR}/nested.html" "Notes" "the nested page"

echo "==> taking a screenshot"
"${CHROME_BIN}" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --user-data-dir="${TMP_DIR}/chrome-profile" \
  --virtual-time-budget=8000 \
  --window-size=1366,768 \
  --screenshot="${TMP_DIR}/screenshot.png" \
  "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || true

echo "All end to end checks passed."
