#!/bin/sh
# The tests of tests/run.php, twice on the PHP that Tori's build uses: under
# `php -S`, then against copper owl served by FrankenPHP with its Caddyfile,
# as Tori serves it. `tests/frankenphp.sh`, with Docker running.
# The container runs as uid 1000 with a read-only root and every capability
# dropped but one: the frankenphp binary carries cap_net_bind_service as a
# file capability, and Linux refuses to start a binary like that in a process
# that cannot have it. The tests run on the image's own PHP, in the
# container's network.
set -eu
cd "$(dirname "$0")/.."
image=copper-owl:frankenphp
name=copper-owl-frankenphp-$$
docker build -q -f tests/frankenphp/Dockerfile -t "$image" . >/dev/null
docker run -d --name "$name" --user 1000 --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges --read-only -e PORT=8080 "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT
status=0
echo "# under php -S, on the image's PHP"
docker run --rm -v "$PWD:/src:ro" -w /src --entrypoint php "$image" tests/run.php || status=$?
echo "# against FrankenPHP and the Caddyfile"
docker run --rm --network "container:$name" -e COPPER_OWL_URL=http://127.0.0.1:8080 -v "$PWD:/src:ro" -w /src --entrypoint php "$image" tests/run.php || status=$?
[ "$status" -eq 0 ] || docker logs "$name" 2>&1 | tail -20
exit "$status"
