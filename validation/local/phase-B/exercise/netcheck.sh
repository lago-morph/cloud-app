#!/bin/sh
# Runs inside `unshare -rn sh scripts/offline.sh`: shows the interfaces and that outbound HTTPS fails.
cat /proc/net/dev
python3 -I -c "import socket; print('loopback bind ok', socket.create_server(('127.0.0.1', 0)).getsockname())"
curl -sS --max-time 5 https://registry.npmjs.org/ -o /dev/null
echo "curl to registry.npmjs.org exit $?"
