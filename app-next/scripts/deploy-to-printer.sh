#!/usr/bin/env bash
#
# Publish app-next to the printer ALONGSIDE the working Mainsail.
#
#   bash app-next/scripts/deploy-to-printer.sh            # build + deploy + verify
#   bash app-next/scripts/deploy-to-printer.sh --check    # verify only, change nothing
#
# Result: http://192.168.11.160:8090/   (the Vue 3 / shadcn-vue rewrite)
#         http://192.168.11.160/        (the working Mainsail, untouched)
#
# ---------------------------------------------------------------------------
# THE ONE RULE THIS SCRIPT EXISTS TO KEEP
# ---------------------------------------------------------------------------
# /home/ultra/mainsail is the interface the user actually prints with. This
# script must never write inside it. Everything here lives in
# /home/ultra/mainsail-next and in its own nginx site file. There is an explicit
# guard below that aborts if REMOTE_DIR is ever pointed at the real Mainsail.
#
# Why a separate port instead of a /next/ location on port 80:
#   - A location block means editing sites-available/mainsail, the live config
#     of the working interface. This way nothing pre-existing is modified, and
#     rollback is `rm` + reload with the original still byte-identical.
#   - Serving from the root of its own port means the bundle needs no Vite
#     `base` rewrite, so what was tested locally is what ships.
# The cost is that the Moonraker proxy blocks are duplicated from the Mainsail
# site. The `apiserver` upstream itself stays shared in conf.d/upstreams.conf,
# so there is still exactly one definition of where Moonraker lives.
#
# Port 8090: 8080-8083 are claimed by the mjpgstreamer1..4 upstreams in
# conf.d/upstreams.conf even though only 8080 currently listens.
#
# nginx is ALWAYS validated with `nginx -t` before reload, so a broken config
# can never take the working Mainsail down.
#
# The /webcam/ proxy below was deliberately absent until 2026-08-18, on the
# grounds that this app showed no camera and an idle MJPEG proxy on a 512 MB
# Orange Pi was a memory risk for no benefit. That reasoning expired with
# /overcam: the camera's stream_url is RELATIVE (`/webcam/?action=stream`), so
# without the proxy the fullscreen view on :8090 has nothing to show. It is a
# location block pointing at the mjpgstreamer1 upstream that already exists in
# conf.d/upstreams.conf -- it costs nothing while nobody is looking at it, and
# the alternative (an absolute URL baked into the client) would break the moment
# the camera moves.
set -euo pipefail

HOST_USER="ultra@192.168.11.160"
HOST_ROOT="root@192.168.11.160"
REMOTE_DIR="/home/ultra/mainsail-next"
PROTECTED_DIR="/home/ultra/mainsail"
PORT=8090
SITE="mainsail-next"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

die() {
    echo "ERROR: $*" >&2
    exit 1
}
ssh_u() { ssh -n -o ConnectTimeout=10 -o BatchMode=yes "$HOST_USER" "$@"; }
ssh_r() { ssh -n -o ConnectTimeout=15 -o BatchMode=yes "$HOST_ROOT" "$@"; }

# Guard: never let this script write into the working Mainsail.
[[ "$REMOTE_DIR" == "$PROTECTED_DIR" || "$REMOTE_DIR" == "$PROTECTED_DIR/"* ]] &&
    die "REMOTE_DIR points at the working Mainsail. Refusing."

verify() {
    echo "--- verifying ---"
    ssh_u "
        set -e
        printf 'new ui  index      : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/
        printf 'new ui  deep link  : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/deep/link
        printf 'new ui  moonraker  : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/printer/info
        # ?action=snapshot, never ?action=stream: a stream is one response that
        # never ends, and curl would hang here forever. --max-time is belt and
        # braces in case the camera itself is wedged.
        printf 'new ui  camera     : '; curl -s -o /dev/null --max-time 10 -w '%{http_code} (%{size_download} bytes)\n' 'http://127.0.0.1:$PORT/webcam/?action=snapshot'
        printf 'WORKING mainsail   : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
        printf 'WORKING moonraker  : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/printer/info
        printf 'WORKING camera     : '; curl -s -o /dev/null --max-time 10 -w '%{http_code} (%{size_download} bytes)\n' 'http://127.0.0.1/webcam/?action=snapshot'
    "
    echo "--- memory (Orange Pi has 512 MB) ---"
    ssh_u "free -m | head -2"
}

if [[ $CHECK_ONLY -eq 1 ]]; then
    verify
    echo
    echo "Open: http://192.168.11.160:$PORT/"
    exit 0
fi

# --- 1. build -------------------------------------------------------------
echo "--- building ---"
cd "$HERE"
command -v node >/dev/null 2>&1 || export PATH="/c/Program Files/nodejs:$PATH"
npm run build

[[ -f "$HERE/dist/index.html" ]] || die "build produced no dist/index.html"

# --- 2. ship --------------------------------------------------------------
# One tarball rather than scp -r: the Pi is slow and each scp round trip costs
# more than the whole 53 KB archive.
echo "--- uploading ---"
TARBALL="$(mktemp -t mainsail-next.XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
tar -czf "$TARBALL" -C "$HERE/dist" .
scp -q -o ConnectTimeout=10 -o BatchMode=yes "$TARBALL" "$HOST_USER:/tmp/mainsail-next.tar.gz"

# Unpack beside the live directory and swap, so a half-extracted tree is never
# what nginx is serving.
ssh_u "
    set -e
    rm -rf $REMOTE_DIR.new
    mkdir -p $REMOTE_DIR.new
    tar -xzf /tmp/mainsail-next.tar.gz -C $REMOTE_DIR.new
    rm -f /tmp/mainsail-next.tar.gz
    rm -rf $REMOTE_DIR.old
    [ -d $REMOTE_DIR ] && mv $REMOTE_DIR $REMOTE_DIR.old || true
    mv $REMOTE_DIR.new $REMOTE_DIR
    rm -rf $REMOTE_DIR.old
    echo 'deployed:'; du -sh $REMOTE_DIR
"

# --- 3. nginx -------------------------------------------------------------
# Idempotent: rewritten every run, then validated. If validation fails the
# reload never happens and the working Mainsail keeps serving the old config.
echo "--- nginx ---"
ssh_r "cat > /etc/nginx/sites-available/$SITE <<'NGINXEOF'
# Managed by app-next/scripts/deploy-to-printer.sh -- edit there, not here.
#
# Serves the Vue 3 / shadcn-vue rewrite on its own port so the working Mainsail
# on port 80 is never touched. See the script header for why a port and not a
# /next/ location.

server {
    listen $PORT;

    access_log /var/log/nginx/mainsail-next-access.log;
    error_log /var/log/nginx/mainsail-next-error.log;

    root $REMOTE_DIR;
    index index.html;
    server_name _;

    client_max_body_size 0;
    proxy_request_buffering off;

    # SPA history fallback: deep links must not 404.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control \"no-store, no-cache, must-revalidate\";
    }

    location /websocket {
        proxy_pass http://apiserver/websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    location ~ ^/(printer|api|access|machine|server)/ {
        proxy_pass http://apiserver\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Scheme \$scheme;
    }

    # The camera, for /overcam. Copied verbatim from the working Mainsail's own
    # site file so both interfaces reach mjpg-streamer the same way.
    #
    # The TRAILING SLASH on proxy_pass is load-bearing: it strips the /webcam/
    # prefix, so /webcam/?action=stream reaches mjpg-streamer as /?action=stream.
    # Without it every frame 404s.
    #
    # buffering off + postpone_output 0: an MJPEG stream is one HTTP response
    # that never ends. Buffered, nginx would hold frames back waiting for a
    # buffer to fill and the picture would arrive in jerks, seconds late.
    location /webcam/ {
        postpone_output 0;
        proxy_buffering off;
        proxy_ignore_headers X-Accel-Buffering;
        access_log off;
        error_log off;
        proxy_pass http://mjpgstreamer1/;
    }
}
NGINXEOF
ln -sfn /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE
nginx -t" || die "nginx config did not validate - NOT reloading, working Mainsail untouched"

ssh_r "systemctl reload nginx" || die "nginx reload failed"
echo "nginx reloaded"

# --- 4. verify ------------------------------------------------------------
sleep 1
verify

# Prove the protected directory was not written to.
echo "--- working Mainsail mtime (must not change across runs) ---"
ssh_u "stat -c '%y %n' $PROTECTED_DIR"

cat <<EOF

Done.
  NEW  (Vue 3 + shadcn-vue) : http://192.168.11.160:$PORT/
  KEPT (working Mainsail)   : http://192.168.11.160/

Rollback, if ever needed:
  ssh $HOST_ROOT 'rm -f /etc/nginx/sites-enabled/$SITE && nginx -t && systemctl reload nginx'
  ssh $HOST_USER 'rm -rf $REMOTE_DIR'
EOF
