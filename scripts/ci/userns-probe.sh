#!/bin/bash
# THROWAWAY probe for ai/implementation/root-causes/2026-11-02-ci-userns-offline.md (attempt 2).
# Never merge. Each command runs on its own and its exit status is printed; nothing stops on error.
cd "$(dirname "$0")/../.." || exit 2
step() { echo; echo "=== PROBE \$ $*"; "$@"; echo "=== PROBE exit status: $?"; }
step uname -a
step cat /etc/os-release
step id
step unshare --version
step sysctl -n kernel.apparmor_restrict_unprivileged_userns
step cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
step cat /proc/sys/user/max_user_namespaces
step cat /sys/module/apparmor/parameters/enabled
step unshare -rn true
step unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
step sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
step sysctl -n kernel.apparmor_restrict_unprivileged_userns
step unshare -rn true
step unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
step unshare -rn sh scripts/offline.sh node -e "fetch('https://api.cloudflare.com/client/v4/').then(() => { console.log('reachable'); process.exit(3); }, (e) => { console.log('unreachable:', e.cause?.code ?? e.message); process.exit(0); })"
# Put the restriction back and show the failure returns: the sysctl alone switches it.
step sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
step unshare -rn true
exit 0
