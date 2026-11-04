#!/bin/sh
# Writes the three S15-S16 configs from the reference deploy/ejabberd/ejabberd.yml. Each is the
# reference with a header comment and at most one changed block; tests/startup/configs.test.ts
# checks that they still match the reference, so re-run this after the reference changes.
#   ref    the reference, unchanged
#   tight  the `player` shaper at 20 kB/s with a 20 kB burst (reference: 50 kB/s, 300 kB burst)
#   http   `shaper: c2s_shaper` on the ejabberd_http listener too (the reference has none there)
set -eu
cd "$(dirname "$0")"
ref=../../../deploy/ejabberd/ejabberd.yml

{
  echo '# S15-S16 spike config `ref`: the reference config, copied unchanged from'
  echo '# deploy/ejabberd/ejabberd.yml by make-configs.sh. tests/startup/configs.test.ts checks it.'
  echo '#'
  cat "$ref"
} > ejabberd-ref.yml

{
  echo '# S15-S16 spike config `tight`: the reference config with a much lower `player` shaper, to show'
  echo "# that a shaped sender's times follow the shaper and not the network or TLS (S16). Written by"
  echo '# make-configs.sh; nothing else differs (tests/startup/configs.test.ts).'
  echo '#'
  sed -e 's/^    rate: 50000$/    rate: 20000 # S16 tight (reference: 50000)/' \
    -e 's/^    burst_size: 300000$/    burst_size: 20000 # S16 tight (reference: 300000)/' "$ref"
} > ejabberd-tight.yml

{
  echo '# S15-S16 spike config `http`: the reference config with `shaper: c2s_shaper` on the'
  echo '# ejabberd_http listener as well, to record whether ejabberd 26.09 accepts a shaper there (S16).'
  echo '# Written by make-configs.sh; nothing else differs (tests/startup/configs.test.ts).'
  echo '#'
  sed -e 's/^    module: ejabberd_http$/    module: ejabberd_http\
    shaper: c2s_shaper # S16 http probe (reference: no shaper on this listener)/' "$ref"
} > ejabberd-http.yml

grep -c 'S16 tight' ejabberd-tight.yml | grep -qx 2 || { echo 'tight: shaper lines not found' >&2; exit 1; }
grep -q 'S16 http probe' ejabberd-http.yml || { echo 'http: listener not found' >&2; exit 1; }
echo 'wrote ejabberd-ref.yml, ejabberd-tight.yml, ejabberd-http.yml'
