#!/bin/sh
# Start the S13 stack (three ejabberd servers, see docker/compose.yaml) and create the admin account
# on each: the operator bootstrap from the reference deployment, the only out-of-band step.
set -eu
cd "$(dirname "$0")/../docker"
docker compose up -d --wait
for s in ejabberd ejabberd-wscap ejabberd-adhocapi; do
  docker compose exec -T "$s" sh /home/ejabberd/bootstrap.sh
done
docker compose ps
