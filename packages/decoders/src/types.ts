/** A captured outgoing request, as seen by Playwright or read from a HAR entry. */
export interface RequestLike {
  url: string;
  method?: string;
  /** Raw request body, if any. */
  body?: string | null;
}

export type Vendor = "ga4" | "meta";

export type ConsentState = "granted" | "denied" | "unknown";

/** One tracking event decoded from a request. A single request can carry several (GA4 batching). */
export interface Hit {
  vendor: Vendor;
  /** Destination ID: GA4 measurement ID (G-XXXX) or Meta pixel ID. */
  destinationId: string;
  event: string;
  /** Event parameters with vendor prefixes stripped; numeric params are numbers. */
  params: Record<string, string | number>;
  /** Vendor-level identifiers (client ID, session ID, event ID, fbp/fbc...). */
  ids: Record<string, string>;
  consent: { adStorage: ConsentState; analyticsStorage: ConsentState; raw?: string };
  /** Host the hit was sent to. A non-Google host for GA4 usually means server-side GTM. */
  host: string;
  url: string;
}

export interface Decoder {
  vendor: Vendor;
  matches(url: URL): boolean;
  decode(request: RequestLike, url: URL): Hit[];
}
