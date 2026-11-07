// one source for the name since it's still semi temporary and will be easier to change later
export const BRAND_NAME = 'Wisp'
export const BT_DEVICE_NAME = 'Wisp'

// the setup guide the Car Thing's QR codes open: Getting started in Wisp's README
export const GUIDE_HOME = 'github.com/picovrfbt/WispOS'
export const GUIDE_BLUETOOTH_URL = `https://${GUIDE_HOME}#over-bluetooth-from-your-phone`
export const GUIDE_USB_URL = `https://${GUIDE_HOME}#over-usb-from-a-pc`

// each release's What's new page on Wisp's website, for the update card's QR
export const whatsNewUrl = (version: string) =>
  `https://picovrfbt.github.io/WispOS/new/${version.replace(/^v/, '')}.html`
