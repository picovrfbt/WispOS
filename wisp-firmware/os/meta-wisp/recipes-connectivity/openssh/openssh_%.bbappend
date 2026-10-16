# root's home is on the read-only root filesystem, so a key can't go in
# ~/.ssh; sshd also reads keys kept on the data partition, in
# /var/lib/ssh/authorized_keys/<user>
do_install:append() {
    echo "AuthorizedKeysFile .ssh/authorized_keys /var/lib/ssh/authorized_keys/%u" >> ${D}${sysconfdir}/ssh/sshd_config
}
