"""The Scrapling capture engine: one scenario of one `CaptureRequest`, run as a child of the Node server.

Node writes one JSON line to stdin (the request and how to run it) and reads NDJSON checkpoints
from stdout as each phase completes; diagnostics go to stderr only. SIGTERM asks for a final
flush; Node kills the process tree after that, or after the `done` checkpoint. The URL policy is
not enforced here: every connection the browser opens goes through Node's egress proxy.
"""

import asyncio
import base64
import json
import re
import signal
import sys
import time
import urllib.error
import urllib.request
from importlib.metadata import version
from urllib.parse import parse_qs, quote, urlsplit

from scrapling.fetchers import AsyncStealthySession

GPC_SCRIPT = (
    "Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', "
    "{ configurable: true, enumerable: true, get: () => true })"
)
AUTOCONSENT_CONFIG = {
    "enabled": True,
    "autoAction": None,
    "disabledCmps": [],
    "enablePrehide": False,
    "detectRetries": 20,
    "enableCosmeticRules": True,
    "enableHeuristicDetection": False,
}
CORS = {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
}
VIEWPORTS = {
    "mobile": {
        "viewport": {"width": 390, "height": 844},
        "screen": {"width": 390, "height": 844},
        "device_scale_factor": 3,
        "is_mobile": True,
        "has_touch": True,
    },
    "desktop": {
        "viewport": {"width": 1366, "height": 768},
        "screen": {"width": 1366, "height": 768},
        "device_scale_factor": 1,
        "is_mobile": False,
        "has_touch": False,
    },
}
QUIET_S = 3.0
WINDOW_CAP_S = 10.0
FLUSH_IDLE_CAP_S = 2.0
CMP_DETECT_S = 10.0
CONSENT_STEP_S = 15.0
# Verifying the consent choice lasts as long as the longest post-action window.
VERIFY_S = 10.0
VERIFY_POLL_S = 0.5
BANNER_CHECK_S = 2.0
# The banner window of a document loaded after the consent action: polled every 500 ms, each frame
# with its own 1.5 s timeout, until the observation window ends but not before 4 s.
BANNER_MIN_S = 4.0
BANNER_POLL_S = 0.5
BANNER_FRAME_S = 1.5
NAVIGATION_TIMEOUT_MS = 30_000
CLICK_TIMEOUT_MS = 5_000
# The index, among `a[href]` in document order, of the first visible http(s) link whose host is
# exactly `host`, or -1. Mirrors FIND_LINK in `src/engines/playwright.ts`.
FIND_LINK = r"""(host) =>
  [...document.querySelectorAll("a[href]")].findIndex((a) => {
    if (a.protocol !== "http:" && a.protocol !== "https:") return false
    if (a.hostname.replace(/\.$/, "") !== host) return false
    const box = a.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && a.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  })"""
CHALLENGE_TITLES = ("Just a moment...", "Attention Required! | Cloudflare")
MAX_URL = 8192
CHUNK_BYTES = 1024 * 1024
SDK_HEADERS = ("user-agent", "accept", "accept-language", "referer", "cookie")
# Talks to Node's egress proxy directly, never through an environment proxy.
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
# autoconsent's Playwright bundle keeps its instance in a local; this names it on `window` so the
# shim's `bannerShown` can re-run the found CMP's popup check after the action. Mirrored in the
# Playwright engine.
AUTOCONSENT_INSTANCE = "const consent = new AutoConsent("
AUTOCONSENT_HANDLE = "const consent = window.__zinkoAutoconsent = new AutoConsent("


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def emit(checkpoint: dict) -> None:
    sys.stdout.write(json.dumps(checkpoint, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def chunks(items: list) -> list[list]:
    """Splits a checkpoint's items so no line comes near Node's per-line limit."""
    out, current, size = [], [], 0
    for item in items:
        n = len(json.dumps(item, ensure_ascii=False))
        if current and size + n > CHUNK_BYTES:
            out.append(current)
            current, size = [], 0
        current.append(item)
        size += n
    return [*out, current] if current else out


def choice_matches(action: str, params) -> bool:
    """A Google consent update that says the choice was made: accept grants ad or analytics
    storage; reject grants nothing and denies storage."""
    if not isinstance(params, dict):
        return False
    storage = (params.get("ad_storage"), params.get("analytics_storage"))
    if action == "optIn":
        return "granted" in storage
    return "granted" not in params.values() and "denied" in storage


def to_cookie(raw: dict) -> dict:
    expires = raw.get("expires", -1)
    same_site = raw.get("sameSite")
    return {
        "name": raw["name"],
        "value": raw["value"],
        "domain": raw["domain"],
        "path": raw["path"],
        # Playwright reports a session cookie as -1
        "expires": None if expires is None or expires < 0 else expires,
        "secure": bool(raw.get("secure")),
        "httpOnly": bool(raw.get("httpOnly")),
        "sameSite": same_site if same_site in ("Strict", "Lax", "None") else "Lax",
    }


async def guard_frame_targets(cdp, patterns: list[dict], on_paused) -> None:
    """OOPIFs have separate Fetch domains; enable each before its scripts run, recursively."""
    auto_attach = {
        "autoAttach": True, "waitForDebuggerOnStart": True, "flatten": False,
        "filter": [{"type": "iframe", "exclude": False}, {"exclude": True}],
    }

    def listen(send):
        children = {}

        def on_event(method: str, params: dict) -> None:
            if method == "Target.receivedMessageFromTarget":
                handler = children.get(params["sessionId"])
                if handler is not None:
                    handler(params["message"])
            elif method == "Target.attachedToTarget":
                session_id = params["sessionId"]
                next_id = 0
                pending = {}

                async def child_send(command: str, args: dict) -> None:
                    nonlocal next_id
                    next_id += 1
                    command_id = next_id
                    future = asyncio.get_running_loop().create_future()
                    pending[command_id] = future
                    await send("Target.sendMessageToTarget", {
                        "sessionId": session_id,
                        "message": json.dumps({"id": command_id, "method": command, "params": args}),
                    })
                    await future

                child_event = listen(child_send)

                def receive(raw: str) -> None:
                    message = json.loads(raw)
                    if "id" in message:
                        future = pending.pop(message["id"], None)
                        if future is not None:
                            if "error" in message:
                                future.set_exception(RuntimeError(str(message["error"])))
                            else:
                                future.set_result(None)
                    elif message.get("method") == "Fetch.requestPaused":
                        on_paused(message["params"], child_send)
                    elif "method" in message:
                        child_event(message["method"], message.get("params", {}))

                children[session_id] = receive

                async def enable() -> None:
                    try:
                        await child_send("Fetch.enable", {"patterns": patterns})
                        await child_send("Target.setAutoAttach", auto_attach)
                        await child_send("Runtime.runIfWaitingForDebugger", {})
                    except Exception as exc:
                        log(f"frame fetch: {exc}")

                asyncio.ensure_future(enable())
            elif method == "Target.detachedFromTarget":
                children.pop(params["sessionId"], None)

        return on_event

    event = listen(cdp.send)
    for method in ("Target.attachedToTarget", "Target.receivedMessageFromTarget", "Target.detachedFromTarget"):
        cdp.on(method, lambda params, method=method: event(method, params))
    await cdp.send("Target.setAutoAttach", auto_attach)


class Capture:
    def __init__(self, job: dict) -> None:
        self.request = job["request"]
        self.started_at = job["startedAt"]
        self.finalize_at = job["finalizeAt"]
        self.job = job
        self.limits = job["limits"]
        vendors = json.loads(open(job["files"]["vendors"], encoding="utf-8").read())
        self.vendor_hosts = vendors["hosts"]
        self.sdk_files = re.compile(vendors["sdkFiles"])
        collection = json.loads(open(job["files"]["collection"], encoding="utf-8").read())
        self.collection = [
            {**endpoint, "path": re.compile(endpoint["path"])}
            for endpoint in collection["endpoints"]
        ]
        self.blocked_redirects: dict[str, list[str]] = {}
        self.observed_redirects: dict[str, list[str]] = {}
        self.block_vendors = bool(self.request.get("blockVendorRequests", False))
        self.scenario = self.request["scenario"]

        self.session = None
        self.context = None
        self.page = None
        self.documents: dict[str, dict] = {}
        self.document_of_request: dict = {}
        # The method of each document's final navigation request: a reload sends it again.
        self.document_method: dict[str, str] = {}
        self.current_document: str | None = None
        self.committed = False
        self.requests: dict[str, dict] = {}
        self.request_ids: dict = {}
        self.dirty: set[str] = set()
        self.inflight: set = set()
        self.blocked: set = set()
        self.last_activity = time.monotonic()
        self.data_layer: list[dict] = []
        self.data_layer_sent = 0
        self.google_observed = 0
        self.consent = {
            "cmp": None,
            "outcome": "none",
            "actionAt": None,
            "completedAt": None,
            "observations": [],
        }
        self.consent_sent = None
        self.truncated = False
        self.truncated_sent = False
        self.admitted = 0
        self.end_taken = False
        self.messages: list[dict] = []
        self.arrived = asyncio.Event()
        self.autoconsent_active = self.scenario in ("accept", "reject")
        self.after_consent_taken = False
        # Once the choice is settled autoconsent only watches: it detects but hides and clicks nothing.
        self.watch_mode = False
        # Node asked this process to wrap up: nothing may wait for a banner window any more.
        self.finalizing = False
        # One banner window per main document, started when it commits and bound to its id.
        self.banner_results: dict[str, str] = {}
        self.banner_windows: dict[str, asyncio.Future] = {}
        self.actions_sent = 0
        # How the next top-level document is reached; a navigation no step asked for is a click.
        self.pending_navigation: str | None = None
        # What verification of the consent action has seen, until `settle_consent` turns it into the outcome.
        self.verification: dict | None = None
        self.verify_task: asyncio.Future | None = None
        self.allowed_hosts: list[str] | None = self.request.get("allowedHosts")
        # The host of the first top-level navigation refused for leaving the site.
        self.left_site: str | None = None
        self.popup_refused = False

    def at(self) -> int:
        return max(0, round(time.time() * 1000 - self.started_at))

    def remaining_ms(self) -> int:
        return max(0, round(self.finalize_at - time.time() * 1000))

    def error(self, code: str, message: str) -> None:
        emit({"type": "error", "error": {"code": code, "message": message[:500], "at": self.at()}})

    def mark_truncated(self) -> None:
        self.truncated = True
        if not self.truncated_sent:
            self.truncated_sent = True
            emit({"type": "truncated"})

    # --- network -----------------------------------------------------------------------------

    def is_vendor_host(self, url: str) -> bool:
        """Mirrors `isVendorHost` in `src/browser-config.ts`, from the same `vendors.json`."""
        try:
            host = (urlsplit(url).hostname or "").rstrip(".")
        except ValueError:
            return False
        return any(host == h or host.endswith("." + h) for h in self.vendor_hosts)

    def is_collection_request(self, method: str, url: str) -> bool:
        """Mirrors the decoders and Playwright, including first-party collector paths."""
        try:
            parsed = urlsplit(url)
        except ValueError:
            return False
        query = parse_qs(parsed.query, keep_blank_values=True)
        return any(
            method.upper() in endpoint["methods"]
            and endpoint["path"].search(parsed.path)
            and all(query.get(key, [None])[0] == value for key, value in endpoint["query"].items())
            for endpoint in self.collection
        )

    def fetch_sdk(self, url: str, headers: dict) -> tuple[int, dict, bytes]:
        """Gets an SDK file through the egress proxy, which refuses the vendor host to the browser."""
        sent = {name: headers[name] for name in SDK_HEADERS if name in headers}
        target = urllib.request.Request(f"{self.job['proxy']}/sdk?url={quote(url, safe='')}", headers=sent)
        try:
            response = DIRECT.open(target, timeout=15)
        except urllib.error.HTTPError as failure:
            response = failure
        with response:
            # Playwright takes repeated headers such as Set-Cookie joined by newlines.
            received: dict[str, str] = {}
            for name, value in response.headers.items():
                key = name.lower()
                if key != "connection":
                    received[key] = f"{received[key]}\n{value}" if key in received else value
            return response.status, received, response.read()

    async def serve_sdk(self, route) -> None:
        req = route.request
        try:
            # all_headers() can wait forever on an intercepted request; build the cookie header here.
            cookies = await self.context.cookies(req.url)
            headers = {**req.headers, "cookie": "; ".join(f"{c['name']}={c['value']}" for c in cookies)}
            status, received, body = await asyncio.to_thread(self.fetch_sdk, req.url, headers)
        except Exception as exc:  # any failure resolves the route, never leaves the request pending
            log(f"sdk {req.url}: {exc}")
            await route.abort("failed")
            return
        await route.fulfill(status=status, headers=received, body=body)

    async def on_route(self, route) -> None:
        req = route.request
        url = req.url
        if self.admitted >= self.limits["requests"]:
            self.mark_truncated()
            await route.abort("blockedbyclient")
            return
        self.admitted += 1
        if self.is_popup_request(req):
            log(f"popup request refused: {url}")
            self.blocked.add(req)
            rid = self.request_ids.get(req)
            if rid is not None:
                self.requests[rid]["blocked"] = True
                self.dirty.add(rid)
            await route.abort("blockedbyclient")
            return
        # The egress proxy refuses vendor hosts outright; these answers only keep page requests on
        # the record, and SDK files come through the proxy's /sdk fetch.
        if self.block_vendors and (self.is_vendor_host(url) or self.is_collection_request(req.method, url)):
            if self.sdk_files.search(url):
                await self.serve_sdk(route)
                return
            self.blocked.add(req)
            rid = self.request_ids.get(req)
            if rid is not None:
                self.requests[rid]["blocked"] = True
                self.dirty.add(rid)
            headers = {**CORS, "access-control-allow-origin": req.headers.get("origin", "*")}
            await route.fulfill(status=204, headers=headers, body="")
            return
        await route.fallback()

    def socket_guard_script(self) -> str:
        """`socket-guard.js` with this run's vendor hosts and collection endpoints filled in."""
        endpoints = [
            {"methods": e["methods"], "path": e["path"].pattern, "query": e["query"]}
            for e in self.collection
        ]
        config = json.dumps({"hosts": self.vendor_hosts, "endpoints": endpoints})
        template = open(self.job["files"]["socketGuard"], encoding="utf-8").read()
        return template.replace("__ZINKO_SOCKET_CONFIG__", config, 1)

    async def on_blocked_socket(self, source, url) -> None:
        """A WebSocket refused before it connected: it has no Request, so it is recorded directly."""
        self.last_activity = time.monotonic()
        if len(self.requests) >= self.limits["requests"]:
            self.mark_truncated()
            return
        if self.current_document is None or not isinstance(url, str):
            return
        if len(url) > MAX_URL:
            self.mark_truncated()
        rid = f"r{len(self.requests) + 1}"
        self.requests[rid] = {
            "id": rid, "documentId": self.current_document, "url": url[:MAX_URL],
            "method": "GET", "body": None, "bodyTruncated": False,
            "resourceType": "websocket", "status": None, "startedAt": self.at(), "blocked": True,
        }
        self.dirty.add(rid)

    def is_main_navigation(self, req) -> bool:
        try:
            return req.is_navigation_request() and req.frame == self.page.main_frame
        except Exception:
            return False

    def on_request(self, req) -> None:
        self.last_activity = time.monotonic()
        self.inflight.add(req)
        if len(self.requests) >= self.limits["requests"]:
            self.mark_truncated()
            return
        try:
            main_navigation = req.is_navigation_request() and req.frame == self.page.main_frame
        except Exception:
            main_navigation = False
        if main_navigation:
            previous = req.redirected_from
            if previous is not None and previous in self.document_of_request:
                doc_id = self.document_of_request[previous]
                self.documents[doc_id]["redirects"].append(previous.url)
                self.documents[doc_id]["url"] = req.url
                self.document_method[doc_id] = req.method
            else:
                doc_id = f"d{len(self.documents) + 1}"
                self.documents[doc_id] = {
                    "id": doc_id,
                    "url": req.url,
                    "redirects": [],
                    "startedAt": self.at(),
                    "title": None,
                    "navigation": "start" if not self.documents else (self.pending_navigation or "click"),
                }
                self.current_document = doc_id
            self.document_of_request[req] = doc_id
            self.document_method.setdefault(doc_id, req.method)
        if self.current_document is None:
            return
        body = None
        body_truncated = False
        raw = req.post_data_buffer
        if raw is not None:
            if len(raw) > self.limits["bodyBytes"]:
                raw = raw[: self.limits["bodyBytes"]]
                body_truncated = True
                self.mark_truncated()
            body = raw.decode("utf-8", errors="replace")
        key = f"{req.method} {req.url}"
        pending = self.blocked_redirects.get(key, []) if req.redirected_from is not None else []
        intercepted = pending.pop(0) if pending else None
        rid = intercepted or f"r{len(self.requests) + 1}"
        if req.redirected_from is not None and intercepted is None:
            self.observed_redirects.setdefault(key, []).append(rid)
        if len(req.url) > MAX_URL:
            self.mark_truncated()
        self.request_ids[req] = rid
        self.requests[rid] = {
            "id": rid,
            "documentId": self.current_document,
            "url": req.url[:MAX_URL],
            "method": req.method,
            "body": body,
            "bodyTruncated": body_truncated,
            "resourceType": req.resource_type,
            "status": 204 if intercepted is not None else None,
            "startedAt": self.at(),
            "blocked": intercepted is not None or req in self.blocked,
        }
        self.dirty.add(rid)

    def on_response(self, response) -> None:
        rid = self.request_ids.get(response.request)
        if rid is not None:
            self.requests[rid]["status"] = response.status
            self.dirty.add(rid)

    def on_request_done(self, req) -> None:
        self.last_activity = time.monotonic()
        self.inflight.discard(req)
        # The request event arrives a few ms late; the browser's own start time, known once the
        # request is over, orders requests correctly against dataLayer pushes.
        rid = self.request_ids.get(req)
        start = req.timing.get("startTime", 0) if rid is not None else 0
        if start > 0:
            self.requests[rid]["startedAt"] = max(0, round(start - self.started_at))
            self.dirty.add(rid)

    async def wait_idle(self, cap_s: float) -> None:
        """Waits until no request has been in flight for 500 ms, at most `cap_s`."""
        deadline = time.monotonic() + cap_s
        while time.monotonic() < deadline:
            if not self.inflight and time.monotonic() - self.last_activity >= 0.5:
                return
            await asyncio.sleep(0.1)

    async def observe_window(self) -> None:
        """Waits until 3 s pass with nothing in flight and no request starting or ending, at most 10 s.

        A request that starts late (a pixel loaded on a timer) restarts the quiet period.
        """
        start = time.monotonic()
        while time.monotonic() < start + WINDOW_CAP_S:
            quiet_since = max(start, self.last_activity)
            if not self.inflight and time.monotonic() - quiet_since >= QUIET_S:
                return
            await asyncio.sleep(0.1)

    # --- site allow-list ------------------------------------------------------------------------

    def off_site(self, url: str) -> str | None:
        """Mirrors `offSite` in `src/engines/playwright.ts`: why `url` may not be a top-level page."""
        if self.allowed_hosts is None:
            return None
        try:
            parts = urlsplit(url)
            host = (parts.hostname or "").removesuffix(".")
            credentials = parts.username is not None or parts.password is not None
        except ValueError:
            return "not a URL"
        if parts.scheme not in ("http", "https"):
            return "not an http(s) page"
        if credentials:
            return "the URL carries credentials"
        # `URL` keeps the brackets around an IPv6 literal; urlsplit drops them.
        host = f"[{host}]" if ":" in host else host
        if any(host == allowed or host.endswith("." + allowed) for allowed in self.allowed_hosts):
            return None
        return f"{host} is not one of the allowed hosts"

    def leave_site(self, url: str, reason: str) -> None:
        if self.left_site is None:
            self.left_site = reason
            self.error("Navigation", f"{url}: {reason}")

    async def guard_navigations(self) -> None:
        """Pauses every main-frame document request, redirect hops included (page routes never see
        those), and fails an off-site one before it is sent. With vendor blocking, pauses all
        resources to answer collection redirects even inside HTTPS tunnels. A navigation that sends no request (`about:blank`, `blob:`) is caught when it commits."""
        if self.allowed_hosts is None and not self.block_vendors:
            return
        cdp = await self.context.new_cdp_session(self.page)
        tree = await cdp.send("Page.getFrameTree")
        main_frame_id = tree["frameTree"]["frame"]["id"]
        seen_network_requests: set[str] = set()

        async def reply(send, method: str, params: dict) -> None:
            try:
                await send(method, params)
            except Exception as exc:
                log(f"fetch: {exc}")

        def on_paused(event: dict, send) -> None:
            url = event["request"]["url"]
            # Cross-scheme redirects may omit redirectedRequestId but keep the Network id.
            network_id = event.get("networkId")
            redirect = event.get("redirectedRequestId") is not None or network_id in seen_network_requests
            if network_id is not None:
                seen_network_requests.add(network_id)
            reason = self.off_site(url) if event.get("resourceType") == "Document" and event.get("frameId") == main_frame_id else None
            if reason is None and self.block_vendors and redirect and not self.sdk_files.search(url) and self.is_collection_request(event["request"]["method"], url):
                # Fetch may answer before Patchright reports the redirected request.
                if self.current_document is not None and len(self.requests) < self.limits["requests"]:
                    request = event["request"]
                    key = f"{request['method']} {url}"
                    observed = self.observed_redirects.get(key, [])
                    rid = observed.pop(0) if observed else f"r{len(self.requests) + 1}"
                    if rid not in self.requests:
                        self.blocked_redirects.setdefault(key, []).append(rid)
                    raw = request["postData"].encode("utf-8") if "postData" in request else None
                    body_truncated = raw is not None and len(raw) > self.limits["bodyBytes"]
                    if body_truncated or len(url) > MAX_URL:
                        self.mark_truncated()
                    self.requests[rid] = {
                        "id": rid, "documentId": self.current_document, "url": url[:MAX_URL],
                        "method": request["method"],
                        "body": raw[:self.limits["bodyBytes"]].decode("utf-8", errors="replace") if raw is not None else None,
                        "bodyTruncated": body_truncated, "resourceType": event["resourceType"].lower(),
                        "status": 204, "startedAt": self.at(), "blocked": True,
                    }
                    self.dirty.add(rid)
                elif len(self.requests) >= self.limits["requests"]:
                    self.mark_truncated()
                origin = next((value for key, value in event["request"]["headers"].items() if key.lower() == "origin"), "*")
                headers = {**CORS, "access-control-allow-origin": origin}
                asyncio.ensure_future(reply(send, "Fetch.fulfillRequest", {
                    "requestId": event["requestId"], "responseCode": 204,
                    "responseHeaders": [{"name": key, "value": value} for key, value in headers.items()],
                    "body": "",
                }))
                return
            if reason is None:
                asyncio.ensure_future(reply(send, "Fetch.continueRequest", {"requestId": event["requestId"]}))
                return
            asyncio.ensure_future(reply(send, "Fetch.failRequest", {"requestId": event["requestId"], "errorReason": "BlockedByClient"}))
            self.leave_site(url, reason)

        def on_navigated(frame) -> None:
            # Chromium's error page follows a failed navigation, which reports its own error.
            if frame != self.page.main_frame or self.current_document is None or frame.url.startswith("chrome-error:"):
                return
            reason = self.off_site(frame.url)
            if reason is not None:
                self.leave_site(frame.url, reason)

        cdp.on("Fetch.requestPaused", lambda event: on_paused(event, cdp.send))
        patterns = [{"urlPattern": "*", "requestStage": "Request", **({} if self.block_vendors else {"resourceType": "Document"})}]
        await cdp.send("Fetch.enable", {"patterns": patterns})
        if self.block_vendors:
            await guard_frame_targets(cdp, patterns, on_paused)
        self.page.on("framenavigated", on_navigated)

    def is_popup_request(self, req) -> bool:
        """Popups get no navigation guard, so with `allowedHosts` every request a popup makes is refused
        in the context route (which sees a popup's first request) and the popup is closed."""
        return self.allowed_hosts is not None and self.page is not None and req.frame.page != self.page

    async def refuse_popup(self, popup) -> None:
        if self.allowed_hosts is None or popup == self.page:
            return
        if not self.popup_refused:
            self.popup_refused = True
            self.error("Navigation", f"popup blocked: the page opened {popup.url}")
        try:
            await popup.close()
        except Exception as exc:
            log(f"popup: {exc}")

    # --- page state ---------------------------------------------------------------------------

    async def evaluate(self, expression: str, frame=None):
        target = frame or self.page.main_frame
        return await target.evaluate(expression, isolated_context=False)

    async def on_data_layer(self, source, entry) -> None:
        if source["frame"] != self.page.main_frame:
            return
        self.add_data_layer([entry])

    def add_data_layer(self, entries: list) -> None:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if entry.get("truncated"):
                self.mark_truncated()
                continue
            if len(self.data_layer) >= self.limits["dataLayer"]:
                self.mark_truncated()
                continue
            at = entry.get("at")
            self.data_layer.append(
                {
                    "at": max(0, round(at - self.started_at)) if isinstance(at, (int, float)) else self.at(),
                    "documentId": self.current_document,
                    "value": entry.get("value"),
                }
            )

    async def drain_page(self) -> None:
        try:
            self.add_data_layer(await self.evaluate("window.__zinko ? window.__zinko.drain() : []"))
            for frame in self.page.frames:
                try:
                    queued = await self.evaluate("window.__zinkoSockets ? window.__zinkoSockets.splice(0) : []", frame)
                except Exception:
                    continue
                for url in queued:
                    await self.on_blocked_socket(None, url)
        except Exception as exc:
            log(f"drain: {exc}")
        doc = self.documents.get(self.current_document or "")
        if doc is not None and self.committed and self.left_site is None:
            try:
                doc["title"] = await self.page.title()
            except Exception as exc:
                log(f"title: {exc}")

    async def observe_consent(self) -> None:
        """Google consent commands seen so far, and the TCF state if the page has a TCF CMP."""
        for entry in self.data_layer[self.google_observed :]:
            value = entry["value"]
            if isinstance(value, list) and len(value) >= 2 and value[0] == "consent":
                state = {"command": value[1], "params": value[2] if len(value) > 2 else None}
                self.consent["observations"].append(
                    {"at": entry["at"], "source": "google", "state": state, "documentId": entry["documentId"]}
                )
        self.google_observed = len(self.data_layer)
        if not self.committed:
            return
        try:
            tcf = await self.evaluate("window.__zinko ? window.__zinko.tcf() : null")
        except Exception as exc:
            log(f"tcf: {exc}")
            return
        if tcf is not None:
            observation = {"at": self.at(), "source": "tcf", "state": tcf}
            if self.current_document is not None:
                observation["documentId"] = self.current_document
            self.consent["observations"].append(observation)

    async def snapshot(self, label: str) -> dict:
        cookies = await self.context.cookies()
        return {
            "at": self.at(),
            "documentId": self.current_document,
            "label": label,
            "cookies": [to_cookie(c) for c in cookies],
        }

    async def checkpoint(self) -> None:
        await self.drain_page()
        for doc in self.documents.values():
            emit({"type": "document", "document": self.with_banner(doc)})
        if self.dirty:
            for part in chunks([self.requests[rid] for rid in sorted(self.dirty)]):
                emit({"type": "requests", "requests": part})
            self.dirty.clear()
        if len(self.data_layer) > self.data_layer_sent:
            for part in chunks(self.data_layer[self.data_layer_sent :]):
                emit({"type": "dataLayer", "entries": part})
            self.data_layer_sent = len(self.data_layer)
        if self.consent != self.consent_sent:
            emit({"type": "consent", "consent": self.consent})
            self.consent_sent = json.loads(json.dumps(self.consent))

    async def flush_beacons(self) -> None:
        """Makes the page believe it is being hidden, so gtag sends the batch it is holding."""
        try:
            await self.evaluate("window.__zinko && window.__zinko.hide()")
        except Exception as exc:
            log(f"hide: {exc}")
        await asyncio.sleep(0.2)
        await self.wait_idle(FLUSH_IDLE_CAP_S)

    async def unhide(self) -> None:
        try:
            await self.evaluate("window.__zinko && window.__zinko.show()")
        except Exception as exc:
            log(f"show: {exc}")

    # --- autoconsent ----------------------------------------------------------------------------

    async def inject_autoconsent(self, frame) -> None:
        if not self.autoconsent_active:
            return
        try:
            await frame.evaluate(self.autoconsent_script, isolated_context=False)
        except Exception as exc:
            log(f"autoconsent inject: {exc}")

    async def on_autoconsent(self, source, message) -> None:
        if not isinstance(message, dict):
            return
        frame = source["frame"]
        kind = message.get("type")
        if kind == "init":
            await frame.evaluate(self.watch_reply if self.watch_mode else self.init_reply, isolated_context=False)
            return
        if kind == "eval":
            try:
                result = await frame.evaluate(message.get("code", ""), isolated_context=False)
            except Exception:
                result = False
            reply = {"id": message.get("id"), "type": "evalResp", "result": result}
            await frame.evaluate(f"autoconsentReceiveMessage({json.dumps(reply)})", isolated_context=False)
            return
        if kind == "autoconsentDone" and self.consent["actionAt"] is not None and not self.after_consent_taken:
            # The after-consent snapshot is taken the moment autoconsent reports completion.
            self.after_consent_taken = True
            self.consent["completedAt"] = self.at()
            emit({"type": "cookies", "snapshot": await self.snapshot("after-consent")})
        self.messages.append({**message, "at": self.at(), "frame": frame})
        self.arrived.set()

    async def wait_message(self, predicate, timeout_s: float) -> dict | None:
        deadline = time.monotonic() + timeout_s
        while True:
            hit = next((m for m in self.messages if predicate(m)), None)
            if hit is not None:
                return hit
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            self.arrived.clear()
            try:
                await asyncio.wait_for(self.arrived.wait(), remaining)
            except TimeoutError:
                pass

    def nothing_detected(self, message: dict) -> bool:
        state = message.get("state") or {}
        return message.get("type") == "report" and message.get("mainFrame") and state.get("lifecycle") == "nothingDetected"

    def consent_update(self, action: str, since: int) -> str | None:
        """`matching` when a Google consent update pushed at or after `since` says what the choice
        means, `contradicting` when updates came but none says so, None when none came."""
        updates = [
            entry["value"][2] if len(entry["value"]) > 2 else None
            for entry in self.data_layer
            if isinstance(entry["value"], list) and entry["value"][:2] == ["consent", "update"] and entry["at"] >= since
        ]
        if not updates:
            return None
        return "matching" if any(choice_matches(action, params) for params in updates) else "contradicting"

    async def banner_shown(self, frame, cmp: str, check: str = "bannerShown", timeout_s: float = BANNER_CHECK_S) -> bool | None:
        # A CMP in an iframe can remove its frame along with the banner.
        if frame.is_detached():
            return False
        try:
            check = frame.evaluate(
                f"window.__zinko ? window.__zinko.{check}({json.dumps(cmp)}) : null", isolated_context=False
            )
            shown = await asyncio.wait_for(check, timeout_s)
        except Exception as exc:
            log(f"banner check: {exc}")
            return None
        return shown if isinstance(shown, bool) else None

    async def banner_now(self, frame, cmp: str, new_document: bool) -> bool | None:
        """The banner in the frame the action ran in or, once the page has loaded a new document (a
        CMP that saves the choice and reloads), in any frame of the new one: shown anywhere is shown."""
        if not new_document:
            return await self.banner_shown(frame, cmp)
        states = [await self.banner_shown(f, cmp) for f in self.page.frames if not f.is_detached()]
        if True in states:
            return True
        return False if False in states else None

    async def probe_banner(self, cmp: str) -> bool | None:
        """One poll of every live frame in parallel: shown anywhere is shown, else hidden on a definite no."""
        states = await asyncio.gather(
            *(self.banner_shown(f, cmp, "bannerWatch", BANNER_FRAME_S) for f in self.page.frames if not f.is_detached()),
            return_exceptions=True,
        )
        values = [state if isinstance(state, bool) else None for state in states]
        if True in values:
            return True
        return False if False in values else None

    def failed_script(self, document_id: str) -> bool:
        """A script request of the document that was refused, failed or got an error status."""
        return any(
            r["documentId"] == document_id
            and r["resourceType"] == "script"
            and not r["blocked"]
            # vendor hosts are refused or answered locally by blockVendorRequests, not by the page
            and not (self.block_vendors and self.is_vendor_host(r["url"]))
            and (r["status"] is None or r["status"] >= 400)
            for r in self.requests.values()
        )

    def with_banner(self, doc: dict) -> dict:
        """Only a verified accept or reject gives a document a banner state."""
        result = self.banner_results.get(doc["id"])
        if result is not None and self.consent["outcome"] in ("accepted", "rejected"):
            return {**doc, "banner": result}
        return doc

    def quiet_now(self) -> bool:
        return not self.inflight and time.monotonic() - self.last_activity >= QUIET_S

    async def observe_banner(self, document_id: str, cmp: str) -> None:
        """Whether the banner of the detected CMP is shown in one document loaded after the consent action.

        Polls from the document's commit, at least `BANNER_MIN_S` and until the network has been
        quiet (at most `WINDOW_CAP_S`). `shown` is sticky (the first poll that sees it wins),
        `hidden` needs a definite no with the CMP shown to be there and no yes, anything else is
        `unknown`; so is a window a navigation interrupts, since what a poll then reads may belong
        to the next document."""
        start = time.monotonic()
        seen_hidden = False
        while True:
            state = await self.probe_banner(cmp)
            if self.current_document != document_id:
                result = "unknown"
                break
            if state is True:
                result = "shown"
                break
            seen_hidden = seen_hidden or state is False
            elapsed = time.monotonic() - start
            if elapsed >= WINDOW_CAP_S or (elapsed >= BANNER_MIN_S and self.quiet_now()):
                result = "hidden" if seen_hidden else "unknown"
                break
            await asyncio.sleep(BANNER_POLL_S)
        # A script of the page that failed may be the consent platform: an absent banner proves nothing.
        if result == "hidden" and self.failed_script(document_id):
            result = "unknown"
        self.banner_results[document_id] = result
        log(f"banner window {document_id}: {result} after {round((time.monotonic() - start) * 1000)} ms")

    async def close_banner_windows(self) -> None:
        """Waits for the windows still open, or at the deadline gives up on them: an unfinished one is `unknown`."""
        open_windows = {doc: task for doc, task in self.banner_windows.items() if not task.done()}
        if open_windows and not self.finalizing:
            await asyncio.wait(open_windows.values(), timeout=WINDOW_CAP_S + 1)
        for doc, task in open_windows.items():
            if not task.done():
                task.cancel()
            self.banner_results.setdefault(doc, "unknown")

    def watch_banner(self, document_id: str) -> None:
        """At a main document's commit: watch its banner, if it loaded after the consent action."""
        document = self.documents.get(document_id)
        if (
            self.consent["cmp"] is None
            or self.consent["actionAt"] is None
            or document is None
            or document["startedAt"] <= self.consent["actionAt"]
            or document_id in self.banner_windows
        ):
            return
        self.banner_windows[document_id] = asyncio.ensure_future(self.observe_banner(document_id, self.consent["cmp"]))

    async def verify_choice(self, frame, document: str | None, deadline: float) -> None:
        """Watches for evidence that the choice took effect, the banner gone or a matching consent
        update, until one appears or `deadline` passes; it runs alongside the post-action window.
        autoconsent's result only says its steps ran: its Cookiebot opt-in reports success whether
        or not it found a button to click."""
        state = self.verification
        while state is self.verification:
            await self.drain_page()
            state["newDocument"] = self.current_document != document
            state["bannerShown"] = await self.banner_now(frame, state["cmp"], state["newDocument"])
            state["consentUpdate"] = self.consent_update(state["action"], state["actionAt"])
            state["checkedAt"] = self.at()
            if state["bannerShown"] is False or state["consentUpdate"] == "matching" or time.monotonic() >= deadline:
                return
            await asyncio.sleep(VERIFY_POLL_S)

    def settle_consent(self) -> None:
        """Turns what verification saw into the outcome, also when Node asks to finalize before it ended.
        Without evidence the outcome is `not-applied`, whether the banner was seen to stay or could
        not be checked: consent rules judged on a choice nobody saw take effect are the bug this fixes."""
        state, self.verification = self.verification, None
        if state is None:
            return
        action, cmp, shown, update = state["action"], state["cmp"], state["bannerShown"], state["consentUpdate"]
        evidence = [
            name
            for name, seen in (("banner-closed", shown is False), ("consent-update", update == "matching"))
            if seen
        ]
        verdict = "applied" if evidence else "not-applied" if shown else "unverified"
        self.consent["observations"].append(
            {
                "at": state["at"],
                "source": "cmp",
                "state": {
                    "event": f"{action}Result",
                    "cmp": cmp,
                    "result": state["reported"],
                    "done": state["done"],
                    "bannerShown": shown,
                    "consentUpdate": update,
                    "newDocument": state["newDocument"],
                    "evidence": evidence,
                    "verdict": verdict,
                },
            }
        )
        if evidence:
            self.consent["outcome"] = "accepted" if action == "optIn" else "rejected"
            if not state["reported"] or not state["done"]:
                self.error("EngineFailure", f"autoconsent {action} on {cmp} did not complete")
            return
        self.consent["outcome"] = "not-applied"
        said = {True: "reported success", False: "reported failure", None: "did not answer"}[state["reported"]]
        followed = {
            None: "no consent update followed",
            "contradicting": "the consent update that followed did not match the choice",
        }[update]
        seconds = max(0, round((state["checkedAt"] - state["actionAt"]) / 1000))
        if verdict == "not-applied":
            why = f"the banner was still shown {seconds} s later and {followed}"
        else:
            why = f"it could not be checked: the banner check gave no answer for {seconds} s and {followed}"
        self.error("ConsentNotApplied", f"autoconsent {action} on {cmp} {said}, but {why}")

    async def run_consent(self, loaded_at: float) -> None:
        action = "optIn" if self.scenario == "accept" else "optOut"
        detect_left = max(0.0, CMP_DETECT_S - (time.monotonic() - loaded_at))
        found = await self.wait_message(
            lambda m: m.get("type") == "popupFound" or self.nothing_detected(m), detect_left
        )
        detected = next((m for m in self.messages if m.get("type") == "cmpDetected"), None)
        if found is None or found.get("type") != "popupFound":
            self.consent["cmp"] = detected.get("cmp") if detected else None
            self.consent["outcome"] = "not-found"
            self.error("CmpNotFound", "autoconsent found no consent banner to act on")
            return
        self.consent["cmp"] = found.get("cmp")
        self.consent["observations"].append(
            {"at": found["at"], "source": "cmp", "state": {"event": "popupFound", "cmp": found.get("cmp")}}
        )
        emit({"type": "cookies", "snapshot": await self.snapshot("before-consent")})
        action_at = self.at()
        document = self.current_document
        self.consent["actionAt"] = action_at
        self.actions_sent += 1
        # Documents loaded from here on (a CMP that reloads the page) get a watching autoconsent.
        self.watch_mode = True
        await found["frame"].evaluate(f"autoconsentReceiveMessage({{ type: '{action}' }})", isolated_context=False)
        result = await self.wait_message(lambda m: m.get("type") == f"{action}Result", CONSENT_STEP_S)
        done = await self.wait_message(lambda m: m.get("type") == "autoconsentDone", CONSENT_STEP_S)
        # autoconsent stays injected until the outcome is settled, so a reloaded page gets an instance
        # that can look for the banner again.
        self.verification = {
            "action": action,
            "cmp": found.get("cmp"),
            "actionAt": action_at,
            "at": self.at() if done is None else done["at"],
            "reported": None if result is None else bool(result.get("result")),
            "done": done is not None,
            "bannerShown": None,
            "consentUpdate": None,
            "newDocument": False,
            "checkedAt": action_at,
        }
        self.verify_task = asyncio.ensure_future(self.verify_choice(found["frame"], document, time.monotonic() + VERIFY_S))

    # --- the capture ------------------------------------------------------------------------------

    async def launch(self) -> None:
        headers = {"Sec-GPC": "1"} if self.scenario == "gpc" else None
        chromium = json.loads(open(self.job["files"]["chromium"], encoding="utf-8").read())
        self.session = AsyncStealthySession(
            headless=True,
            google_search=False,
            block_webrtc=True,
            init_script=self.job["files"]["shim"],
            user_data_dir=self.job["profileDir"],
            extra_headers=headers,
            extra_flags=[*chromium["args"], f"--proxy-server={self.job['proxy']}"],
            additional_args={**VIEWPORTS[self.request["viewport"]], "service_workers": "block"},
        )
        # Chromium keeps only the last --disable-features, and Scrapling passes its own in no fixed
        # order, so swap it for the merged list in src/chromium-args.json (Scrapling 0.5 internals).
        options = self.session._browser_options
        # Scrapling also drops Playwright's --disable-component-update, and that filter removes ours
        # too; the component updater then calls update.googleapis.com.
        options["ignore_default_args"] = [
            arg for arg in options["ignore_default_args"] if arg != "--disable-component-update"
        ]
        options["args"] = [
            *(arg for arg in options["args"] if not arg.startswith("--disable-features=")),
            "--disable-features=" + ",".join(chromium["disableFeatures"]),
        ]
        await self.session.start()
        self.context = self.session.context
        emit({"type": "engine", "name": "scrapling", "version": f"{version('scrapling')} (patchright {version('patchright')})"})

    async def run(self) -> None:
        files = self.job["files"]
        script = open(files["autoconsent"], encoding="utf-8").read()
        if AUTOCONSENT_INSTANCE not in script:
            raise RuntimeError("the autoconsent bundle changed: no instance to name for the banner check")
        self.autoconsent_script = script.replace(AUTOCONSENT_INSTANCE, AUTOCONSENT_HANDLE, 1)
        rules = json.loads(open(files["rules"], encoding="utf-8").read())
        init = {"type": "initResp", "config": AUTOCONSENT_CONFIG, "rules": rules}
        self.init_reply = f"autoconsentReceiveMessage({json.dumps(init)})"
        watch = {**init, "config": {**AUTOCONSENT_CONFIG, "enableCosmeticRules": False}}
        self.watch_reply = f"autoconsentReceiveMessage({json.dumps(watch)})"
        await self.launch()
        ctx = self.context
        if self.scenario == "gpc":
            await ctx.add_init_script(script=GPC_SCRIPT)
        await ctx.route("**/*", self.on_route)
        if self.block_vendors:
            await ctx.add_init_script(script=self.socket_guard_script())
        ctx.on("request", self.on_request)
        ctx.on("response", self.on_response)
        ctx.on("requestfinished", self.on_request_done)
        ctx.on("requestfailed", self.on_request_done)
        self.page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await self.guard_navigations()
        ctx.on("page", self.refuse_popup)
        self.page.on("pageerror", lambda exc: log(f"pageerror: {exc}"))

        def on_commit(frame) -> None:
            if frame == self.page.main_frame and self.current_document is not None and not frame.url.startswith("chrome-error:"):
                self.watch_banner(self.current_document)

        self.page.on("framenavigated", on_commit)
        await self.page.expose_binding("__zinkoDataLayer", self.on_data_layer)
        if self.block_vendors:
            await self.page.expose_binding("__zinkoBlockedSocket", self.on_blocked_socket)
        if self.autoconsent_active:
            await self.page.expose_binding("autoconsentSendMessage", self.on_autoconsent)
            self.page.on("framenavigated", lambda frame: asyncio.ensure_future(self.inject_autoconsent(frame)))

        if not await self.navigate(
            self.request["url"],
            "Navigation",
            lambda timeout: self.page.goto(self.request["url"], wait_until="load", timeout=timeout),
        ):
            await self.finish()
            return
        loaded_at = time.monotonic()
        await self.inject_autoconsent(self.page.main_frame)
        await self.observe_window()
        await self.observe_consent()
        await self.checkpoint()
        if self.left_site is not None:
            # The page sent itself off the site (a script redirect) while it was being observed.
            await self.finish()
            return

        if self.scenario in ("accept", "reject"):
            await self.run_consent(loaded_at)
            await self.checkpoint()
            if self.consent["completedAt"] is not None:
                await self.observe_window()
            if self.verify_task is not None:
                await self.verify_task
                self.settle_consent()
            if self.consent["completedAt"] is not None:
                await self.observe_consent()
            await self.checkpoint()

        for index, step in enumerate(self.request.get("journey", [])):
            if not await self.run_step(index, step):
                break
            await self.checkpoint()

        await self.finish()

    async def navigate(self, label: str, code: str, go) -> bool:
        timeout = min(NAVIGATION_TIMEOUT_MS, self.remaining_ms())
        try:
            response = await go(timeout)
        except Exception as exc:
            # A refused off-site hop has its own `Navigation` error.
            if self.left_site is None:
                self.error(code, f"{label}: {exc}".split("\n")[0])
            await self.checkpoint()
            return False
        self.committed = True
        title = ""
        try:
            title = await self.page.title()
        except Exception as exc:
            log(f"title: {exc}")
        if response is None:
            return True
        document = self.documents.get(self.current_document) if self.current_document is not None else None
        if document is not None:
            document["status"] = response.status
        if response.headers.get("cf-mitigated") == "challenge" or title in CHALLENGE_TITLES:
            self.error("BotBlocked", f"{label}: the page answered with a bot challenge ({response.status})")
        elif response.status >= 400:
            self.error("HttpStatus", f"{label}: HTTP {response.status}")
        return True

    async def follow_link(self, index: int, host: str, before: str | None) -> bool:
        """Clicks the first visible link to exactly `host` and waits for the document it opens.

        Mirrors `followLink` in `src/engines/playwright.ts`: it succeeds only when a new main-frame
        document committed on `host` or a subdomain of it; anything else is a `JourneyStep` error,
        and a host the allow-list refuses ends the capture with its own `Navigation` error.
        """
        label = f"step {index + 1} follow {host}"
        position = await self.page.evaluate(f"({FIND_LINK})({json.dumps(host)})")
        if not isinstance(position, int) or position < 0:
            self.error("JourneyStep", f"{label}: no visible link to {host} on {self.page.url}")
            return False
        timeout = min(NAVIGATION_TIMEOUT_MS, self.remaining_ms())
        navigated = asyncio.ensure_future(
            self.page.wait_for_event(
                "framenavigated", predicate=lambda frame: frame == self.page.main_frame, timeout=timeout
            )
        )
        try:
            await self.page.locator("a[href]").nth(position).click(timeout=CLICK_TIMEOUT_MS)
        except Exception as exc:
            navigated.cancel()
            self.error("JourneyStep", f"{label}: {exc}".split("\n")[0])
            return False
        deadline = time.monotonic() + timeout / 1000
        while not navigated.done() and self.left_site is None and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        if self.left_site is not None:
            navigated.cancel()
            await self.checkpoint()
            return False
        if not navigated.done() or navigated.exception() is not None:
            navigated.cancel()
            self.error("JourneyStep", f"{label}: the click did not open a page")
            return False
        try:
            await self.page.wait_for_load_state("load", timeout=min(NAVIGATION_TIMEOUT_MS, self.remaining_ms()))
        except Exception as exc:
            self.error("JourneyStep", f"{label}: {exc}".split("\n")[0])
            return False
        self.committed = True
        if self.current_document == before:
            self.error("JourneyStep", f"{label}: the click stayed on the same page")
            return False
        arrival = (urlsplit(self.page.url).hostname or "").rstrip(".")
        # `URL` keeps the brackets around an IPv6 literal, as the contract's canonical host does; urlsplit drops them.
        arrival = f"[{arrival}]" if ":" in arrival else arrival
        if arrival != host and not arrival.endswith("." + host):
            self.error("JourneyStep", f"{label}: arrived at {arrival}")
            return False
        return True

    async def run_step(self, index: int, step: dict) -> bool:
        if self.left_site is not None:
            return False
        before = self.current_document
        # Leaving a page ends its banner window, so let it finish first.
        if before in self.banner_windows:
            # shielded: a deadline cancels this step, not the window task that other code still owns
            await asyncio.shield(self.banner_windows[before])
        await self.flush_beacons()
        held = await self.snapshot("document-end")
        await self.observe_consent()
        await self.checkpoint()
        await self.unhide()
        # Checked last, right before the reload: a form the page submits by itself (on a timer, or on
        # the pagehide the flush above causes) can swap the document while this step waited.
        if step["action"] == "reload":
            method = self.document_method.get(self.current_document) if self.current_document is not None else None
            navigating = any(self.is_main_navigation(request) for request in self.inflight)
            if self.current_document != before:
                refusal = "the page navigated by itself"
            elif navigating:
                refusal = "the page is navigating"
            elif method == "GET":
                refusal = None
            else:
                refusal = f"the page was loaded with {method or 'an unknown method'}, and a reload would send it again"
            if refusal is not None:
                self.error("JourneyStep", f"step {index + 1} reload of {self.page.url}: {refusal}")
                return False
        if step["action"] in ("goto", "reload"):
            emit({"type": "cookies", "snapshot": held})
            self.pending_navigation = step["action"]
            if step["action"] == "goto":
                opened = await self.navigate(
                    step["url"],
                    "JourneyStep",
                    lambda timeout: self.page.goto(step["url"], wait_until="load", timeout=timeout),
                )
            else:
                opened = await self.navigate(
                    f"step {index + 1} reload of {self.page.url}",
                    "JourneyStep",
                    lambda timeout: self.page.reload(wait_until="load", timeout=timeout),
                )
            if not opened:
                self.pending_navigation = None
                return False
        elif step["action"] == "follow":
            self.pending_navigation = "follow"
            if not await self.follow_link(index, step["host"], before):
                self.pending_navigation = None
                return False
        else:
            self.pending_navigation = "click"
            try:
                await self.page.click(step["selector"], timeout=CLICK_TIMEOUT_MS)
                await self.page.wait_for_load_state("load", timeout=min(NAVIGATION_TIMEOUT_MS, self.remaining_ms()))
            except Exception as exc:
                self.pending_navigation = None
                self.error("JourneyStep", f"step {index + 1} click {step['selector']}: {exc}".split("\n")[0])
                return False
        self.pending_navigation = None
        banner = (
            self.banner_windows.get(self.current_document)
            if self.current_document not in (None, before)
            else None
        )
        await asyncio.gather(self.observe_window(), *([asyncio.shield(banner)] if banner is not None else []))
        if step["action"] not in ("goto", "reload") and self.current_document != before:
            emit({"type": "cookies", "snapshot": held})
        # A click can start an off-site navigation after `load` has already resolved.
        return self.left_site is None

    async def finish(self) -> None:
        """The end snapshot and the screenshot. Also the cooperative flush when Node asks to finalize."""
        if self.page is None:
            return
        if self.verification is not None:
            self.verify_task.cancel()
            self.settle_consent()
        await self.close_banner_windows()
        # After a refused navigation the page shows Chromium's error page: nothing to photograph.
        if self.committed and self.left_site is None:
            try:
                shot = await self.page.screenshot(type="png", scale="css", timeout=5000)
                emit({"type": "screenshot", "data": base64.b64encode(shot).decode("ascii")})
            except Exception as exc:
                self.error("EngineFailure", f"screenshot: {exc}".split("\n")[0])
            await self.flush_beacons()
        if not self.end_taken and self.current_document is not None:
            self.end_taken = True
            emit({"type": "cookies", "snapshot": await self.snapshot("end")})
        await self.observe_consent()
        await self.checkpoint()


async def finalize_safely(capture: Capture) -> None:
    """The final flush, bounded; if it does not finish, whatever was gathered is still checkpointed."""
    try:
        await asyncio.wait_for(capture.finish(), 4)
    except (Exception, asyncio.CancelledError) as exc:
        log(f"finalize: {type(exc).__name__}: {exc}")
        try:
            await asyncio.wait_for(capture.checkpoint(), 2)
        except (Exception, asyncio.CancelledError) as checkpoint_exc:
            log(f"final checkpoint: {type(checkpoint_exc).__name__}: {checkpoint_exc}")


async def main() -> None:
    job = json.loads(sys.stdin.readline())
    capture = Capture(job)
    finalizing = asyncio.Event()

    def finalize() -> None:
        if not finalizing.is_set():
            finalizing.set()
            capture.finalizing = True
            work.cancel()

    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, finalize)
    work = asyncio.ensure_future(capture.run())
    try:
        await work
    except asyncio.CancelledError:
        if not finalizing.is_set():
            raise
        capture.error("Timeout", "the capture ran past its time limit; this is what was captured until then")
        await finalize_safely(capture)
    except Exception as exc:
        if capture.context is None:
            emit({"type": "launch-failed", "message": f"{type(exc).__name__}: {exc}".split("\n")[0]})
        else:
            capture.error("EngineFailure", f"{type(exc).__name__}: {exc}".split("\n")[0])
            await finalize_safely(capture)
    log(f"actionsSent={capture.actions_sent}")
    emit({"type": "done"})
    # Node kills this process and the browser once it reads `done`.
    await asyncio.Event().wait()


asyncio.run(main())
