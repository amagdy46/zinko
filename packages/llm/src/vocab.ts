import type { Vendor } from "@zinko/decoders"

export const VENDOR_LABELS: Record<Vendor, string> = {
  ga4: "GA4",
  "google-ads": "Google Ads",
  meta: "Meta",
  tiktok: "TikTok",
}

const DESTINATION_FORMATS: Record<Vendor, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,12}$/,
  "google-ads": /^AW-\d{6,12}$/,
  meta: /^\d{10,20}$/,
  tiktok: /^[A-Z0-9]{10,30}$/,
}

/**
 * Whether a destination ID has the shape its vendor's real IDs have. The decoders accept any value
 * for `tid` or a pixel code, so a page can put text there; the shape check is a filter, not proof:
 * a string that fits the format is sent as it is.
 */
export function isKnownDestination(vendor: Vendor, id: string): boolean {
  return DESTINATION_FORMATS[vendor].test(id)
}

const KNOWN_EVENTS: Record<Vendor, ReadonlySet<string>> = {
  ga4: new Set([
    "add_payment_info",
    "add_shipping_info",
    "add_to_cart",
    "add_to_wishlist",
    "begin_checkout",
    "click",
    "file_download",
    "first_visit",
    "form_start",
    "form_submit",
    "generate_lead",
    "login",
    "page_view",
    "purchase",
    "refund",
    "remove_from_cart",
    "scroll",
    "search",
    "select_content",
    "select_item",
    "select_promotion",
    "session_start",
    "share",
    "sign_up",
    "user_engagement",
    "video_complete",
    "video_progress",
    "video_start",
    "view_cart",
    "view_item",
    "view_item_list",
    "view_promotion",
    "view_search_results",
  ]),
  "google-ads": new Set(["conversion", "remarketing"]),
  meta: new Set([
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
    "PageView",
    "Purchase",
    "Schedule",
    "Search",
    "StartTrial",
    "SubmitApplication",
    "Subscribe",
    "ViewContent",
  ]),
  tiktok: new Set([
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
    "Search",
    "SubmitForm",
    "Subscribe",
    "ViewContent",
    "Pageview",
  ]),
}

/** Whether an event name is one of the vendor's fixed standard events; any other name is page-controlled text. */
export function knownEvent(vendor: Vendor, name: string): boolean {
  return KNOWN_EVENTS[vendor].has(name)
}

const PUSH_COMMANDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["consent", ["default", "update"]],
  ["config", []],
  ["event", []],
])

/** The words of a `dataLayer` push worth naming, only from a fixed list; anything else is "push". */
export function pushCommand(value: unknown): string {
  if (!Array.isArray(value)) return "push"
  const [first, second] = value
  if (typeof first !== "string") return "push"
  const subcommands = PUSH_COMMANDS.get(first)
  if (subcommands === undefined) return "push"
  if (subcommands.length === 0) return first
  return typeof second === "string" && subcommands.includes(second) ? `${first} ${second}` : "push"
}
