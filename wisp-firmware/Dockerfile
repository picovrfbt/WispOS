FROM ghcr.io/void-linux/void-glibc:20250801R1
LABEL org.opencontainers.image.licenses="Apache-2.0"

# upgrade the whole base image, not just xbps: the tools below come from the
# current repo, and a newer rsync against the base image's older acl fails with
# "libacl.so.1: version ACL_1.3 not found"
RUN xbps-install -Suy xbps && xbps-install -Suy

RUN xbps-install -uy bash curl dosfstools e2fsprogs findutils util-linux gzip \
    git m4 mtools pigz tar zstd xz zip mkpasswd zip unzip just rsync \
    autoconf automake libtool pkg-config make gcc confuse-devel openssl patchelf

RUN curl -L https://github.com/pengutronix/genimage/archive/refs/tags/v18.tar.gz | tar --use-compress-program=pigz -x -C /tmp \
    && cd /tmp/genimage-18 \
    && ./autogen.sh \
    && ./configure \
    && make -j$(nproc) \
    && make install \
    && cd / \
    && rm -rf /tmp/genimage-18

COPY resources/ /work/resources/
COPY scripts/ /work/scripts/
COPY docker-entrypoint.sh build.sh /work/
# the iPhone-volume sidecar needs Rust and is optional (stage 20 skips it when
# absent); the [7] glob lets COPY match nothing instead of failing the build
COPY go-librespot-armv6 ui.zip go-librespot-config.yml lp.env iap2-sidecar-armv[7] /work/
COPY voice-artifacts/ /work/voice-artifacts/
# custom wake words; stage 30-voice bundles them and WAKE_MODEL picks one
COPY wake-models/ /work/wake-models/
# Wisp's patched wake listener (manual listen trigger), see voice-patches/
COPY voice-bin/ /work/voice-bin/

WORKDIR /work

CMD ["/bin/bash", "/work/docker-entrypoint.sh"]
