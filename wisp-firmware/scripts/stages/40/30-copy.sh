#!/bin/sh

rm "$OUTPUT_PATH"/* 2> /dev/null || true

mv "$IMAGE_PATH"/system.ext4 "$IMAGE_PATH"/system_a.ext2
cp "$IMAGE_PATH"/system_a.ext2 "$IMAGE_PATH"/system_b.ext2

cd "$RES_PATH"/stock-files/extract/ || exit 1
# Stock partitions copied verbatim
cp bootloader.dump dtbo_a.dump dtbo_b.dump fip_a.dump fip_b.dump misc.dump vbmeta_a.dump vbmeta_b.dump "$IMAGE_PATH"/

# Custom kernel
CUSTOM_BOOT="$RES_PATH"/kernel/boot_custom.dump
if [ ! -f "$CUSTOM_BOOT" ]; then
  color_echo "Missing $CUSTOM_BOOT - build the kernel + boot image first (see the thing-kernel repo)." -Red
  exit 1
fi
cp "$CUSTOM_BOOT" "$IMAGE_PATH"/boot_a.dump
cp "$CUSTOM_BOOT" "$IMAGE_PATH"/boot_b.dump

cp "$RES_PATH"/flash/env.txt "$RES_PATH"/flash/logo.dump "$IMAGE_PATH"/

# Flash recipe
sed "s/@IMAGE_VERSION@/${IMAGE_VERSION#v}/" "$RES_PATH"/flash/meta.json > "$IMAGE_PATH"/meta.json
cp "$RES_PATH"/kernel/superbird_evt_512.dtb "$IMAGE_PATH"/superbird.dtb
cp "$RES_PATH"/flash/factory_dtb.bin "$IMAGE_PATH"/factory_dtb.bin
{
  cat "$RES_PATH"/flash/boot_hwpart_header.bin
  head -c 2096640 "$RES_PATH"/stock-files/extract/bootloader.dump
} > "$IMAGE_PATH"/boot_hwpart_wisp.bin

cd "$IMAGE_PATH"/ || exit 1
zip -r9 "$OUTPUT_PATH"/wisp_firmware_"$IMAGE_VERSION".zip .
