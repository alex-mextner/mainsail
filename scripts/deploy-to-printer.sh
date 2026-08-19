#!/usr/bin/env bash
#
# Publish THIS fork (the Vue 2 tree, src/) to the printer.
#
#   bash scripts/deploy-to-printer.sh --stage      # build + publish to :8091, the live site untouched
#   bash scripts/deploy-to-printer.sh --live       # build + publish to :8090, with a backup
#   bash scripts/deploy-to-printer.sh --check      # verify both, change nothing
#   bash scripts/deploy-to-printer.sh --rollback   # restore the newest backup to :8090
#   bash scripts/deploy-to-printer.sh --unstage    # remove the staging site and directory
#
# 🔴 2026-08-19: THIS TREE NO LONGER OWNS PORT 80.
# On the user's request the two interfaces swapped ports. The Vue 3 fork
# (app-next, branch feat/vue3-migration) is now the primary interface on port 80;
# this Vue 2 build is the fallback, on :8090. So "live" below means :8090, not
# :80 -- the directory it deploys to (/home/ultra/mainsail) has not changed, only
# the port nginx serves it on.
#
# The port itself lives in /etc/nginx/sites-available/mainsail, which is
# hand-managed and NOT written by this script (unlike the staging site file
# below). Its authoritative copy is tracked in the printer repo under
# orangepi-system/nginx/mainsail. If you ever need to change the live port,
# change it there and in that file -- not here.
#
# Until 2026-08-18 this deploy was done by hand, which is why there was no
# rehearsal step and no scripted way back. Both exist here:
#
#   --stage  serves the same bundle from /home/ultra/mainsail-stage on port 8091,
#            through a site file of its own. The live directory is not touched at
#            all, so a layout change can be looked at on the real machine, with
#            the real camera, before the fallback interface is replaced.
#   --live   copies /home/ultra/mainsail to /home/ultra/mainsail.bak.<stamp>
#            first, and --rollback puts the newest such backup back.
#
# Two files in the deployed tree belong to the MACHINE, not to the build, and
# are carried over instead of overwritten:
#   config.json  the printer's copy has hostname/port null (same-origin); the
#                working tree's copy is pointed at 192.168.11.160:7125 for local
#                development, and shipping that would hard-wire the address.
#   .version     deliberately pinned to the upstream tag so Moonraker's update
#                manager does not offer an "update" that would replace the fork
#                with a stock build. See docs/tasks.md in the printer repo.
set -euo pipefail

HOST_USER="ultra@192.168.11.160"
HOST_ROOT="root@192.168.11.160"
LIVE_DIR="/home/ultra/mainsail"
LIVE_PORT=8090          # set in sites-available/mainsail, not written by this script
STAGE_DIR="/home/ultra/mainsail-stage"
STAGE_PORT=8091
STAGE_SITE="mainsail-stage"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

die() {
    echo "ERROR: $*" >&2
    exit 1
}
ssh_u() { ssh -n -o ConnectTimeout=10 -o BatchMode=yes "$HOST_USER" "$@"; }
ssh_r() { ssh -n -o ConnectTimeout=15 -o BatchMode=yes "$HOST_ROOT" "$@"; }

usage() {
    sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
}

build() {
    echo "--- building ---"
    cd "$HERE"
    command -v node >/dev/null 2>&1 || export PATH="/c/Program Files/nodejs:$PATH"
    npx vite build
    [[ -f "$HERE/dist/index.html" ]] || die "build produced no dist/index.html"
}

# One tarball rather than scp -r: the Pi is slow and every round trip costs more
# than the whole archive.
upload() {
    local target="$1"
    echo "--- uploading to $target ---"
    local tarball
    tarball="$(mktemp -t mainsail-fork.XXXXXX.tar.gz)"
    # dist/mainsail.zip is the release artifact, it has no business in the web root
    tar -czf "$tarball" -C "$HERE/dist" --exclude=mainsail.zip .
    scp -q -o ConnectTimeout=10 -o BatchMode=yes "$tarball" "$HOST_USER:/tmp/mainsail-fork.tar.gz"
    rm -f "$tarball"

    # unpack beside the served directory and swap, so a half-extracted tree is
    # never what nginx is handing out
    ssh_u "
        set -e
        rm -rf $target.new
        mkdir -p $target.new
        tar -xzf /tmp/mainsail-fork.tar.gz -C $target.new
        rm -f /tmp/mainsail-fork.tar.gz
        # carry the machine's own files over the freshly built ones
        for keep in config.json .version; do
            [ -f $target/\$keep ] && cp -p $target/\$keep $target.new/\$keep || true
        done
        # first deploy into this directory (staging): there was nothing to carry
        # over, and the built config.json is the DEVELOPMENT one, pointing at
        # 192.168.11.160:7125. Served from the printer it must be same-origin, or
        # the camera breaks: /webcam/ is proxied by nginx, not by Moonraker.
        if [ ! -f $target/config.json ]; then
            sed -e 's/\"hostname\": *\"[^\"]*\"/\"hostname\": null/' \
                -e 's/\"port\": *\"[^\"]*\"/\"port\": null/' \
                $target.new/config.json > $target.new/config.json.tmp
            mv $target.new/config.json.tmp $target.new/config.json
        fi
        rm -rf $target.old
        [ -d $target ] && mv $target $target.old || true
        mv $target.new $target
        rm -rf $target.old
        echo 'deployed:'; du -sh $target
    "
}

verify() {
    echo "--- verifying ---"
    # The <title> lines are the point: an HTTP 200 only says something answered,
    # not WHICH app answered. Since the two interfaces swapped ports on
    # 2026-08-19, plain 'Mainsail' must be on :$LIVE_PORT and 'Mainsail Next'
    # (the Vue 3 fork) on :80. If those two are the other way round, the swap
    # has been half-undone and one of the site files needs looking at.
    ssh_u "
        printf 'live :$LIVE_PORT title  : '; curl -s --max-time 10 http://127.0.0.1:$LIVE_PORT/ | grep -o '<title>[^<]*</title>' || echo '(no title!)'
        printf 'live :$LIVE_PORT index  : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$LIVE_PORT/
        printf 'live :$LIVE_PORT overcam: '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$LIVE_PORT/overcam/mbot
        printf 'live :$LIVE_PORT moonrkr: '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$LIVE_PORT/printer/info
        # ?action=snapshot, never ?action=stream: a stream is one response that never
        # ends and curl would hang here for good.
        printf 'live :$LIVE_PORT camera : '; curl -s -o /dev/null --max-time 10 -w '%{http_code} (%{size_download} bytes)\n' 'http://127.0.0.1:$LIVE_PORT/webcam/?action=snapshot'
        printf 'live :$LIVE_PORT config : '; curl -s http://127.0.0.1:$LIVE_PORT/config.json | tr -d ' \n' | head -c 120; echo
        if [ -d $STAGE_DIR ]; then
            printf 'stage :$STAGE_PORT index : '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$STAGE_PORT/
        fi
        printf 'PRIMARY :80 title  : '; curl -s --max-time 10 http://127.0.0.1/ | grep -o '<title>[^<]*</title>' || echo '(no title!)'
        printf 'live version      : '; cat $LIVE_DIR/.version 2>/dev/null || echo '(none)'
        echo '--- backups ---'; ls -d $LIVE_DIR.bak.* 2>/dev/null || echo '(none)'
    "
    echo "--- memory (Orange Pi has 512 MB) ---"
    ssh_u "free -m | head -2"
}

case "$MODE" in
    --stage)
        build
        upload "$STAGE_DIR"
        echo "--- nginx (staging site only, the live site file is not touched) ---"
        ssh_r "cat > /etc/nginx/sites-available/$STAGE_SITE <<'NGINXEOF'
# Managed by scripts/deploy-to-printer.sh --stage -- edit there, not here.
# A rehearsal copy of the working Mainsail, on its own port. Delete with --unstage.
server {
    listen $STAGE_PORT;

    access_log off;
    error_log /var/log/nginx/mainsail-stage-error.log;

    root $STAGE_DIR;
    index index.html;
    server_name _;

    client_max_body_size 0;
    proxy_request_buffering off;

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

    # trailing slash is load-bearing: it strips /webcam/ so mjpg-streamer sees
    # /?action=stream. buffering off, or the frames arrive in jerks.
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
ln -sfn /etc/nginx/sites-available/$STAGE_SITE /etc/nginx/sites-enabled/$STAGE_SITE
nginx -t" || die "nginx config did not validate - NOT reloading, port 80 untouched"
        ssh_r "systemctl reload nginx" || die "nginx reload failed"
        verify
        echo
        echo "Staged: http://192.168.11.160:$STAGE_PORT/overcam/mbot   (live :$LIVE_PORT and primary :80 unchanged)"
        ;;

    --live)
        build
        STAMP="$(date +%Y-%m-%d-%H%M)"
        echo "--- backing up $LIVE_DIR -> $LIVE_DIR.bak.$STAMP ---"
        ssh_u "set -e; cp -a $LIVE_DIR $LIVE_DIR.bak.$STAMP; du -sh $LIVE_DIR.bak.$STAMP"
        upload "$LIVE_DIR"
        verify
        echo
        cat <<EOF

Live: http://192.168.11.160:$LIVE_PORT/overcam/mbot   (fallback interface since the port swap)
Rollback: bash scripts/deploy-to-printer.sh --rollback   (restores $LIVE_DIR.bak.$STAMP)
EOF
        ;;

    --rollback)
        ssh_u "
            set -e
            newest=\$(ls -d $LIVE_DIR.bak.* 2>/dev/null | sort | tail -1)
            [ -n \"\$newest\" ] || { echo 'no backup to roll back to' >&2; exit 1; }
            echo \"restoring \$newest\"
            rm -rf $LIVE_DIR.rollback
            cp -a \"\$newest\" $LIVE_DIR.rollback
            rm -rf $LIVE_DIR.broken
            mv $LIVE_DIR $LIVE_DIR.broken
            mv $LIVE_DIR.rollback $LIVE_DIR
            rm -rf $LIVE_DIR.broken
        "
        verify
        ;;

    --unstage)
        ssh_r "rm -f /etc/nginx/sites-enabled/$STAGE_SITE /etc/nginx/sites-available/$STAGE_SITE && nginx -t && systemctl reload nginx"
        ssh_u "rm -rf $STAGE_DIR"
        echo "staging site and directory removed"
        ;;

    --check)
        verify
        ;;

    *)
        usage
        ;;
esac
