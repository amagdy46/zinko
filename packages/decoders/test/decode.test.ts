import { describe, expect, it } from "vitest"
import { decode } from "../src/index.js"

const GA4 =
  "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&gcs=G100&cid=111.222&sid=333&dl=https%3A%2F%2Fshop.test%2Fthanks"

describe("ga4", () => {
  it("decodes a single GET hit with params, ids and consent", () => {
    const [hit, ...rest] = decode({
      url: `${GA4}&en=purchase&ep.transaction_id=T1&epn.value=49.9&cu=EUR`,
    })
    expect(rest).toHaveLength(0)
    expect(hit).toMatchObject({
      vendor: "ga4",
      destinationId: "G-ABC123",
      event: "purchase",
      params: {
        transaction_id: "T1",
        value: 49.9,
        currency: "EUR",
        page_location: "https://shop.test/thanks",
      },
      ids: { clientId: "111.222", sessionId: "333" },
      consent: { adStorage: "denied", analyticsStorage: "denied", raw: "G100" },
      host: "region1.google-analytics.com",
    })
  })

  it("splits batched POST bodies into one hit per line", () => {
    const hits = decode({
      url: GA4,
      method: "POST",
      body: "en=page_view\nen=add_to_cart&epn.value=10",
    })
    expect(hits.map((h) => h.event)).toEqual(["page_view", "add_to_cart"])
    expect(hits[1]?.params.value).toBe(10)
  })

  it("recognizes first-party server-side GTM endpoints", () => {
    const [hit] = decode({
      url: "https://metrics.shop.test/g/collect?v=2&tid=G-ABC123&en=page_view&gcs=G111",
    })
    expect(hit?.host).toBe("metrics.shop.test")
    expect(hit?.consent).toMatchObject({ adStorage: "granted", analyticsStorage: "granted" })
  })

  it("ignores Universal Analytics and malformed URLs", () => {
    expect(decode({ url: "https://www.google-analytics.com/g/collect?v=1&tid=UA-1&en=x" })).toEqual(
      [],
    )
    expect(decode({ url: "not a url" })).toEqual([])
  })
})

describe("meta", () => {
  it("decodes a pixel GET hit with custom data and event id", () => {
    const [hit] = decode({
      url: "https://www.facebook.com/tr/?id=1234567890&ev=Purchase&eid=evt-1&cd[value]=49.9&cd[currency]=EUR&cd[content_ids]=123&fbp=fb.1.1.1&dl=https%3A%2F%2Fshop.test%2Fthanks",
    })
    expect(hit).toMatchObject({
      vendor: "meta",
      destinationId: "1234567890",
      event: "Purchase",
      params: {
        value: 49.9,
        currency: "EUR",
        content_ids: "123",
        page_location: "https://shop.test/thanks",
      },
      ids: { eventId: "evt-1", fbp: "fb.1.1.1" },
    })
  })

  it("reads form-encoded POST bodies", () => {
    const [hit] = decode({
      url: "https://www.facebook.com/tr/",
      method: "POST",
      body: "id=42&ev=Lead&eid=e2",
    })
    expect(hit).toMatchObject({ destinationId: "42", event: "Lead", ids: { eventId: "e2" } })
  })

  it("ignores unrelated facebook.com paths", () => {
    expect(decode({ url: "https://www.facebook.com/plugins/like.php?id=1&ev=x" })).toEqual([])
  })
})
