#!/usr/bin/env sh
# Packages the plugin as dist/anyhour.zip, with a anyhour/ folder
# inside, ready for Plugins → Add New → Upload Plugin.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/dist/anyhour.zip"

if command -v php >/dev/null 2>&1; then
  find "$here/anyhour" -name '*.php' -exec php -l {} \; >/dev/null
fi

mkdir -p "$here/dist"
rm -f "$out"
(cd "$here" && zip -rq "$out" anyhour -x '*.DS_Store')
echo "Built $out"
