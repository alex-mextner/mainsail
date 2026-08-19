#!/usr/bin/env bash
#
# Publish app-next to the printer as the PRIMARY interface, on port 80.
#
#   bash app-next/scripts/deploy-to-printer.sh            # build + deploy + verify
#   bash app-next/scripts/deploy-to-printer.sh --check    # verify only, change nothing
#
# Result: http://192.168.11.160/       (this fork -- Vue 3 / shadcn-vue)
#         http://192.168.11.160:8090/  (the old Mainsail, kept as a fallback)
#
# ---------------------------------------------------------------------------
# 2026-08-19: THE PORTS WERE SWAPPED, ON THE USER'S REQUEST
# ---------------------------------------------------------------------------
# This fork used to live on :8090 while the old Mainsail held port 80. That is
# now the other way round: the fork is what you get by typing the printer's bare
# address, and the old Mainsail answers on :8090.
#
# What that changes for this script: PORT is 80, and the site file written below
# is the only server listening on port 80. Getting it wrong now takes the
# machine's main interface down, so two things below are no longer cosmetic --
# the `nginx -t` gate before every reload, and the rollback path in the footer.
#
# The old Mainsail's port lives in ITS OWN site file (sites-available/mainsail,
# hand-managed, copy tracked in the printer repo under orangepi-system/nginx/).
# This script does not touch it. Both files must never name the same port: two
# servers on 80 with `server_name _` is not an error to nginx, it just silently
# hands the port to whichever include sorts first -- and `mainsail` sorts before
# `mainsail-next`, so a collision would hide this app behind the old one.
#
# ---------------------------------------------------------------------------
# THE ONE RULE THIS SCRIPT EXISTS TO KEEP
# ---------------------------------------------------------------------------
# /home/ultra/mainsail is the fallback interface, and it is the one with a
# working Emergency Stop button. This script must never write inside it.
# Everything here lives in /home/ultra/mainsail-next and in its own nginx site
# file. There is an explicit guard below that aborts if REMOTE_DIR is ever
# pointed at it.
#
# Why two site files rather than one with a /next/ location:
#   - Each interface owns its own file, so either can be repointed, disabled or
#     rolled back without editing the other one's live config.
#   - Serving from the root of a port means the bundle needs no Vite `base`
#     rewrite, so what was tested locally is what ships.
# The cost is that the Moonraker proxy blocks are duplicated between the two
# site files. The `apiserver` upstream itself stays shared in
# conf.d/upstreams.conf, so there is still exactly one definition of where
# Moonraker lives.
#
# Port 8090 for the old Mainsail: 8080-8083 are claimed by the mjpgstreamer1..4
# upstreams in conf.d/upstreams.conf even though only 8080 currently listens,
# and 8091 is the staging copy driven by the Vue 2 tree's own deploy script.
#
# nginx is ALWAYS validated with `nginx -t` before reload, so a broken config
# can never take port 80 down.
#
# The /webcam/ proxy below was deliberately absent until 2026-08-18, on the
# grounds that this app showed no camera and an idle MJPEG proxy on a 512 MB
# Orange Pi was a memory risk for no benefit. That reasoning expired with
# /overcam: the camera's stream_url is RELATIVE (`/webcam/?action=stream`), so
# without the proxy the fullscreen view has nothing to show. It is a location
# block pointing at the mjpgstreamer1 upstream that already exists in
# conf.d/upstreams.conf -- it costs nothing while nobody is looking at it, and
# the alternative (an absolute URL baked into the client) would break the moment
# the camera moves. Since the port swap it also carries
# http://192.168.11.160/webcam/?action=stream, the camera URL printed in
# docs/safety.md -- that link is now served by THIS file.
set -euo pipefail

HOST_USER="ultra@192.168.11.160"
HOST_ROOT="root@192.168.11.160"
REMOTE_DIR="/home/ultra/mainsail-next"
PROTECTED_DIR="/home/ultra/mainsail"
PORT=80
FALLBACK_PORT=8090   # the old Mainsail, sites-available/mainsail (not ours)
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
    # The <title> check is the point of this block: an HTTP 200 only proves
    # something answered, not WHICH interface answered. Since the two apps swap
    # ports, "200 on 80" would have looked identical before and after a mistake.
    # 'Mainsail Next' is this fork, plain 'Mainsail' is the old one.
    ssh_u "
        set -e
        printf 'THIS fork  :$PORT title : '; curl -s --max-time 10 http://127.0.0.1:$PORT/ | grep -o '<title>[^<]*</title>' || echo '(no title!)'
        printf 'THIS fork  index        : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/
        printf 'THIS fork  deep link    : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/deep/link
        printf 'THIS fork  moonraker    : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/printer/info
        # ?action=snapshot, never ?action=stream: a stream is one response that
        # never ends, and curl would hang here forever. --max-time is belt and
        # braces in case the camera itself is wedged.
        printf 'THIS fork  camera       : '; curl -s -o /dev/null --max-time 10 -w '%{http_code} (%{size_download} bytes)\n' 'http://127.0.0.1:$PORT/webcam/?action=snapshot'
        printf 'THIS fork  websocket    : '; curl -s -o /dev/null -w '%{http_code} (101 = upgraded)\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:$PORT/websocket
        printf 'FALLBACK   :$FALLBACK_PORT title : '; curl -s --max-time 10 http://127.0.0.1:$FALLBACK_PORT/ | grep -o '<title>[^<]*</title>' || echo '(no title!)'
        printf 'FALLBACK   moonraker    : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$FALLBACK_PORT/printer/info
        printf 'FALLBACK   camera       : '; curl -s -o /dev/null --max-time 10 -w '%{http_code} (%{size_download} bytes)\n' 'http://127.0.0.1:$FALLBACK_PORT/webcam/?action=snapshot'
    "
    echo "--- memory (Orange Pi has 512 MB) ---"
    ssh_u "free -m | head -2"
}

if [[ $CHECK_ONLY -eq 1 ]]; then
    verify
    echo
    echo "Open: http://192.168.11.160/          (this fork)"
    echo "      http://192.168.11.160:$FALLBACK_PORT/     (old Mainsail, fallback)"
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
# Serves the Vue 3 / shadcn-vue fork as the PRIMARY interface on port 80
# (swapped with the old Mainsail on 2026-08-19). The old Mainsail is now on
# :8090 via sites-available/mainsail, which this file must never name.

server {
    listen $PORT;

    access_log /var/log/nginx/mainsail-next-access.log;
    error_log /var/log/nginx/mainsail-next-error.log;

    # Carried over from the old Mainsail's site file when this app took over
    # port 80: whatever answers on 80 is what gets loaded over wifi from a
    # tablet at the machine, and this bundle (echarts-gl) is the heavier of the
    # two. Same settings as the file that used to serve this port.
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_proxied expired no-cache no-store private auth;
    gzip_comp_level 4;
    gzip_buffers 16 8k;
    gzip_http_version 1.1;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/x-javascript application/json application/xml;

    root $REMOTE_DIR;
    index index.html;
    server_name _;

    client_max_body_size 0;
    proxy_request_buffering off;

    # 🔴 EVICT THE OLD MAINSAIL'S SERVICE WORKER FROM THIS ORIGIN.
    #
    # Until 2026-08-19 port 80 served the Vue 2 Mainsail, which is a PWA: it
    # registered /sw.js (workbox, registerType 'autoUpdate', ~218 precached
    # files) against http://<printer>/ in every browser that ever opened it --
    # the user's laptop and the tablet at the machine. That registration belongs
    # to the ORIGIN, not to the bundle, so it survived the port swap and would
    # keep serving the cached old-Mainsail shell from the bare address. The swap
    # would simply look like it never happened, on exactly the devices that
    # matter.
    #
    # It does not heal by itself either. Without this block /sw.js falls through
    # to the SPA fallback below and answers 200 text/html; a service worker
    # update check treats that as a failed update and KEEPS the old worker
    # registered. Browsers only drop a registration when the script returns
    # 404/410 -- hence this.
    #
    # Effect: an affected browser shows the old interface for one more load (the
    # one whose update check gets this 404 and unregisters), then the fork.
    # curl never sees any of this, because curl has no service worker.
    #
    # This app ships no service worker of its own. If it ever does, and at this
    # same path, remove this block -- it would 404 our own worker.
    # The old Mainsail keeps serving its real /sw.js on :8090, which is a
    # separate origin and is supposed to have its own worker.
    location = /sw.js {
        access_log off;
        return 404;
    }

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
  PRIMARY  (this fork, Vue 3)   : http://192.168.11.160/
  FALLBACK (old Mainsail)       : http://192.168.11.160:$FALLBACK_PORT/

Rollback.
  Until 2026-08-19 this footer said "rm /etc/nginx/sites-enabled/$SITE". DO NOT
  DO THAT ANY MORE -- this site file is now the only server on port 80, and
  removing it leaves the machine with no interface on its bare address.

  To put the OLD Mainsail back on port 80 (i.e. undo the swap), on the printer:
      ssh $HOST_ROOT 'sh /root/nginx-portswap-*/restore.sh'
  That restores every site file to its pre-swap state and reloads nginx. The
  same files are tracked in the printer repo under orangepi-system/nginx/ if
  the /root copy is ever lost. Reverting the swap in nginx WITHOUT also
  reverting the commit that set PORT=80 above will put the two site files back
  in conflict on the next run of this script -- revert both, or neither.

  To back out only a bad BUILD, keeping the ports as they are, redeploy from a
  known-good commit; the site file does not need touching.
EOF
