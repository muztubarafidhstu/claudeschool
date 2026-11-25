#!/usr/bin/env bash
# Installs / updates ScholarDesk Pro (subscription panel + license API) at https://scool.rafid5.com
# on the SAME server as rafid5.com, behind the existing Caddy. Safe to run again to update.
#
#   Needs /opt/scholardesk-data/.env with ADMIN_PASSWORD_HASH_B64, LICENSE_PRIVATE_KEY_B64,
#   LICENSE_PUBLIC_KEY_B64 (the private setup script you received creates it).
set -euo pipefail

DOMAIN="${SCOOL_DOMAIN:-scool.rafid5.com}"
BRANCH="${SCOOL_BRANCH:-scholardesk-pro-v1}"
REPO="https://github.com/muztubarafidhstu/claudeschool.git"
APP_DIR=/opt/scholardesk
DATA=/opt/scholardesk-data

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (ssh root@your-server)."
command -v docker >/dev/null || die "Docker is not installed on this server."
[ -f "$DATA/.env" ] || die "$DATA/.env not found. Run the private setup script first."

say "Preparing folders"
mkdir -p "$DATA"/{pgdata,backups,releases}
chmod 700 "$DATA"; chmod 600 "$DATA/.env"
grep -q '^POSTGRES_PASSWORD=' "$DATA/.env" || echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> "$DATA/.env"
grep -q '^ADMIN_JWT_SECRET=' "$DATA/.env" || echo "ADMIN_JWT_SECRET=$(openssl rand -hex 32)" >> "$DATA/.env"
grep -q '^CORS_ORIGINS=' "$DATA/.env" || echo "CORS_ORIGINS=https://$DOMAIN" >> "$DATA/.env"

say "Getting the code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" && git -C "$APP_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi

say "Finding the existing Caddy (HTTPS) container"
CADDY=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /caddy/ {print $1; exit}')
[ -n "$CADDY" ] || die "No running Caddy container found. Is rafid5.com running on this server?"
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CADDY" | awk '{print $1}')
CF=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$CADDY")
[ -n "$NET" ] && [ -n "$CF" ] || die "Could not read Caddy's network or Caddyfile."
echo "Caddy: $CADDY · network: $NET · Caddyfile: $CF"

say "Building and starting ScholarDesk (first time takes 3–6 minutes)"
export DATA_DIR="$DATA" CADDY_NETWORK="$NET"
cd "$APP_DIR/deploy/vps"
docker compose --env-file "$DATA/.env" up -d --build

say "Waiting for the app to become healthy"
for i in $(seq 1 60); do
  if docker exec scholardesk-app wget -qO- http://localhost:8080/api/v1/health >/dev/null 2>&1; then echo "App is up."; break; fi
  [ "$i" = 60 ] && { docker logs --tail 40 scholardesk-app; die "App did not start."; }
  sleep 3
done

say "Adding $DOMAIN to Caddy"
if ! grep -q "^$DOMAIN" "$CF"; then
  cp "$CF" "$CF.bak-$(date +%Y%m%d%H%M%S)"
  # Append (never rewrite) so Caddy's bind-mounted file keeps the same inode.
  printf '\n# ScholarDesk Pro — school subscription panel + license API\n%s {\n\tencode gzip\n\treverse_proxy scholardesk-app:8080\n}\n' "$DOMAIN" >> "$CF"
fi
docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

say "Nightly database backup (03:30, keeps 30 days)"
cat > /etc/cron.d/scholardesk-backup <<CRON
30 3 * * * root docker exec scholardesk-db pg_dump -U scholardesk scholardesk | gzip > $DATA/backups/scholardesk-\$(date +\%F).sql.gz && find $DATA/backups -name '*.sql.gz' -mtime +30 -delete
CRON

say "Checking https://$DOMAIN (the HTTPS certificate can take up to a minute)"
for i in $(seq 1 20); do
  if curl -fsS "https://$DOMAIN/api/v1/health" >/dev/null 2>&1; then
    printf '\n\033[1;32mDONE! Open https://%s and sign in with your password.\033[0m\n' "$DOMAIN"; exit 0
  fi
  sleep 6
done
echo
echo "The app runs, but https://$DOMAIN is not answering yet. Most likely DNS:"
echo "  add an A record  scool -> $(curl -fsS https://api.ipify.org 2>/dev/null || echo 'this server IP')  at your domain provider, wait 10 minutes, then run this script again."
