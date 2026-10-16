# shellcheck disable=SC2148

# self heal the writable partitions
PATH=/usr/bin:/usr/sbin

for _mira_part in /dev/data /dev/settings; do
    [ -b "$_mira_part" ] || continue
    grep -q "^${_mira_part} " /proc/mounts && continue

    e2fsck -p "$_mira_part" > /dev/null 2>&1
    _mira_rc=$?
    if [ "$_mira_rc" -ge 4 ]; then
        msg "fsck: preen failed on ${_mira_part} (rc=${_mira_rc}), trying full auto-fix..."
        echo "MIRA_FSCK: preen failed on ${_mira_part} (rc=${_mira_rc}), running e2fsck -y" > /dev/kmsg
        e2fsck -y "$_mira_part" > /dev/null 2>&1
        _mira_rc=$?
    fi

    if [ "$_mira_rc" -ge 4 ]; then
        msg "fsck: ${_mira_part} unrecoverable (rc=${_mira_rc}), reformatting..."
        echo "MIRA_FSCK: ${_mira_part} unrecoverable (rc=${_mira_rc}), reformatting" > /dev/kmsg
        case "$_mira_part" in
            /dev/data) /sbin/reset-data ;;
            /dev/settings) /sbin/reset-settings ;;
        esac
    fi
done
