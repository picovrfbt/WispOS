SUMMARY = "Wisp's on-device voice"
DESCRIPTION = "Wake word (openWakeWord on TFLite) and speech-to-text (sherpa-onnx Zipformer): a self-contained aarch64 bundle with its own loader and libraries, staged by scripts/prepare.sh from the same artifacts the original firmware ships."
LICENSE = "CLOSED"

# payload/ is staged by scripts/prepare.sh:
#   bin/ lib/ (incl. ld-linux-aarch64.so.1)  -> /usr/lib/wisp/voice
#   models/ zipformer/ meaning/ espeak-ng-data/ -> /usr/share/wisp/voice
SRC_URI = "file://payload/"
S = "${UNPACKDIR}"

# prebuilt, with its own libc and loader: the daemon runs it through
# /usr/lib/wisp/voice/ld-linux-aarch64.so.1 --library-path, so nothing here
# resolves against the image's libraries
INSANE_SKIP:${PN} = "already-stripped ldflags file-rdeps dev-so libdir textrel arch"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
EXCLUDE_FROM_SHLIBS = "1"
SKIP_FILEDEPS:${PN} = "1"

do_install() {
    V=${D}/usr/lib/wisp/voice
    install -d $V/bin ${D}/usr/share/wisp/voice
    install -m 0755 ${S}/payload/bin/* $V/bin/
    cp -R --no-preserve=ownership ${S}/payload/lib/. $V/
    chmod 0755 $V/ld-linux-aarch64.so.1
    for d in models zipformer meaning espeak-ng-data; do
        cp -R --no-preserve=ownership ${S}/payload/$d ${D}/usr/share/wisp/voice/
    done
}

FILES:${PN} = "/usr/lib/wisp/voice /usr/share/wisp/voice"
