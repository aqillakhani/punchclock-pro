# syntax=docker/dockerfile:1
#
# PunchClock Pro — self-hosted Postgres 16 + TimescaleDB + PostGIS for Fly.io.
#
# The schema needs two extensions that managed Neon/Supabase don't offer:
#   - timescaledb : hypertables on time_entry_events + audit_logs (001_initial_schema.sql)
#   - postgis     : geofencing (organization geofence + distance checks)
# so we run our own single-node Postgres on a Fly volume.
#
# Deploy (from repo root):
#   flyctl deploy deploy/db --config deploy/db/fly.toml
#
FROM postgres:16-bookworm

# TimescaleDB (Timescale's packagecloud repo) + PostGIS (PGDG repo, already
# configured inside the official postgres image).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates gnupg lsb-release wget; \
    echo "deb https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/timescaledb.list; \
    wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey \
      | gpg --dearmor > /etc/apt/trusted.gpg.d/timescaledb.gpg; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      timescaledb-2-postgresql-16 \
      postgresql-16-postgis-3; \
    rm -rf /var/lib/apt/lists/*

# Self-signed TLS cert so the API can connect with DATABASE_SSL=true. The app
# uses node-postgres with rejectUnauthorized:false, so a self-signed cert is
# fine; Fly's private network is already encrypted, this just satisfies the
# Postgres SSL handshake the app's prod hardening requires.
RUN set -eux; \
    mkdir -p /etc/postgresql/certs; \
    openssl req -new -x509 -days 3650 -nodes -text \
      -subj "/CN=punchclock-db" \
      -out /etc/postgresql/certs/server.crt \
      -keyout /etc/postgresql/certs/server.key; \
    chown postgres:postgres /etc/postgresql/certs/server.crt /etc/postgresql/certs/server.key; \
    chmod 600 /etc/postgresql/certs/server.key

# Keep the data dir in a SUBDIR of the mounted volume — the volume root holds
# ext4's lost+found, which would make initdb's empty-directory check fail.
ENV PGDATA=/var/lib/postgresql/data/pgdata

# Preload TimescaleDB and enable TLS.
CMD ["postgres", \
     "-c", "shared_preload_libraries=timescaledb", \
     "-c", "ssl=on", \
     "-c", "ssl_cert_file=/etc/postgresql/certs/server.crt", \
     "-c", "ssl_key_file=/etc/postgresql/certs/server.key"]
