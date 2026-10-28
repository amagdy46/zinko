import { vendorName } from "./documents.js"
import type { DecodedHit } from "./types.js"

/** Meta's standard events, except PageView, which is rarely sent from the server as well. */
export const META_STANDARD_EVENTS: ReadonlySet<string> = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "CompleteRegistration",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "InitiateCheckout",
  "Lead",
  "Purchase",
  "Schedule",
  "Search",
  "StartTrial",
  "SubmitApplication",
  "Subscribe",
  "ViewContent",
])

/**
 * TikTok's standard events as they appear on the wire: the pixel sends `CompletePayment` as
 * `Purchase`. `Pageview` is left out, as Meta's `PageView` is.
 */
export const TIKTOK_STANDARD_EVENTS: ReadonlySet<string> = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "ClickButton",
  "CompletePayment",
  "CompleteRegistration",
  "Contact",
  "Download",
  "InitiateCheckout",
  "PlaceAnOrder",
  "Purchase",
  "Search",
  "SubmitForm",
  "Subscribe",
  "ViewContent",
])

const GA4_EVENTS: ReadonlySet<string> = new Set([
  "page_view",
  "purchase",
  "add_to_cart",
  "remove_from_cart",
  "add_to_wishlist",
  "add_payment_info",
  "add_shipping_info",
  "begin_checkout",
  "view_item",
  "view_item_list",
  "view_cart",
  "select_item",
  "select_promotion",
  "view_promotion",
  "generate_lead",
  "login",
  "sign_up",
  "search",
  "share",
  "refund",
  "scroll",
  "click",
  "file_download",
  "form_start",
  "form_submit",
  "video_start",
  "video_progress",
  "video_complete",
  "user_engagement",
  "session_start",
  "first_visit",
])

const KNOWN: Record<DecodedHit["vendor"], ReadonlySet<string>> = {
  ga4: GA4_EVENTS,
  "google-ads": new Set(["conversion", "page_view"]),
  meta: new Set([...META_STANDARD_EVENTS, "PageView"]),
  tiktok: new Set([...TIKTOK_STANDARD_EVENTS, "Pageview"]),
}

/**
 * A vendor and event for a message. An event name is chosen by the page and can hold personal
 * data, so only a standard name is printed; any other is "a custom event".
 */
export function eventLabel(hit: Pick<DecodedHit, "vendor" | "event">): string {
  const vendor = vendorName(hit.vendor)
  return KNOWN[hit.vendor].has(hit.event) ? `${vendor} ${hit.event}` : `${vendor} custom event`
}

const DESTINATION_ID = /^(?:(?:G|GT|AW|DC|GTM)-[A-Z0-9]{4,16}|\d{6,20}|[A-Z0-9]{10,24})$/

/** A measurement, pixel or conversion ID for a message when it has the shape of one; else a fixed phrase. */
export function destinationLabel(id: string): string {
  return DESTINATION_ID.test(id) ? id : "an unrecognised ID"
}
