/**
 * Bounded browser observations, deliberately independent of application data.
 * No URL, message, stack, DOM text, user/session ID, payload or header is sent.
 * Only same-origin requests are measured; trace headers are never injected.
 */
const VERSION = 1;
const MAX_AGE = 5 * 60 * 1000;
const EVENT_LIMIT = 120;
const TYPES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const finiteDuration = (value) => Number.isFinite(value) && value >= 0 && value <= 120000;
const rounded = (value) => Math.round(value * 1000) / 1000;

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function collectorOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/vibe/runtime/config"].includes(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}

function descriptorOf(data, origin) {
  try {
    const collect = new URL(data.collectUrl);
    const ttl = Date.parse(data.expiresAt) - Date.now();
    if (data.version !== VERSION || typeof data.descriptor !== "string" || !data.descriptor || data.descriptor.length > 8192 || collect.origin !== origin || collect.pathname !== "/vibe/runtime/events" || collect.search || collect.hash || collect.username || collect.password || !Number.isFinite(ttl) || ttl <= 0 || ttl > 86400000 || !Number.isInteger(data.maxBatchSize) || data.maxBatchSize < 1 || data.maxBatchSize > 32 || !Number.isInteger(data.maxBatchBytes) || data.maxBatchBytes < 1024 || data.maxBatchBytes > 65536 || !Number.isFinite(data.sampleRate) || data.sampleRate < 0 || data.sampleRate > 1) return null;
    return { ...data, expires: Date.parse(data.expiresAt) };
  } catch { return null; }
}

export function startBrowserTelemetry({ collector, sourceCommit }) {
  const origin = collectorOrigin(collector);
  if (!origin || !/^[0-9a-f]{40}$/i.test(sourceCommit || "") || typeof window === "undefined" || !globalThis.crypto?.getRandomValues || !window.fetch || !window.performance || navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return () => {};
  const originalFetch = window.fetch;
  const cleanups = [], observers = [], timers = new Set(), frames = new Set(), controllers = new Set();
  let stopped = false, descriptor = null, queue = [], sending = false, sampled = null, configFailures = 0;
  let rootRecorded = false;
  let activeTrace = randomHex(16), activeSpan = randomHex(8), windowStart = Date.now(), eventCount = 0;
  let lcp = null, lcpReported = false, fcpReported = false, navigationReported = false;
  const timeout = (fn, delay) => { const id = setTimeout(() => { timers.delete(id); if (!stopped) fn(); }, delay); timers.add(id); return id; };
  const listen = (target, name, fn, options) => { target.addEventListener(name, fn, options); cleanups.push(() => target.removeEventListener(name, fn, options)); };
  const identity = () => ({ traceId: activeTrace, spanId: randomHex(8), parentSpanId: activeSpan });
  const begin = () => { rootRecorded = false; activeTrace = randomHex(16); activeSpan = randomHex(8); return { traceId: activeTrace, spanId: activeSpan }; };
  const observedAt = (start) => new Date(performance.timeOrigin + start).toISOString();
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const record = (event) => {
    const now = Date.now(), age = now - Date.parse(event.timestamp);
    if (event.parentSpanId && !rootRecorded) return;
    if (stopped || !descriptor || sampled !== true || descriptor.expires <= now || age > MAX_AGE || age < -60000) return;
    if (now - windowStart >= 60000) { windowStart = now; eventCount = 0; }
    if (eventCount >= EVENT_LIMIT || queue.length >= 128 || bytes(event) > 1024) return;
    eventCount++;
    queue.push(event);
    if (!event.parentSpanId && event.traceId === activeTrace && event.spanId === activeSpan) rootRecorded = true;
    if (queue.length >= descriptor.maxBatchSize) void flush();
  };
  const send = async (url, body, keepalive = false) => {
    const controller = new AbortController(); controllers.add(controller);
    const timer = timeout(() => controller.abort(), 5000);
    try {
      return await originalFetch.call(window, url, { method: "POST", credentials: "omit", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive, signal: controller.signal });
    } finally { clearTimeout(timer); timers.delete(timer); controllers.delete(controller); }
  };
  async function flush(keepalive = false) {
    if (stopped || sending || !descriptor || descriptor.expires <= Date.now()) return;
    queue = queue.filter((event) => Date.now() - Date.parse(event.timestamp) <= MAX_AGE);
    if (!queue.length) return;
    const events = [];
    while (queue.length && events.length < descriptor.maxBatchSize) {
      const next = queue[0];
      if (bytes({ version: VERSION, descriptor: descriptor.descriptor, events: [...events, next] }) > descriptor.maxBatchBytes) break;
      events.push(queue.shift());
    }
    if (!events.length) { queue.shift(); return; }
    sending = true;
    try { await send(descriptor.collectUrl, { version: VERSION, descriptor: descriptor.descriptor, events }, keepalive); }
    catch { /* Best effort; no replay when acknowledgement is unknown. */ }
    finally { sending = false; }
  }
  const retryConfiguration = () => { descriptor = null; configFailures++; if (configFailures < 5) timeout(configure, Math.min(60000, 15000 * 2 ** (configFailures - 1))); };
  async function configure() {
    try {
      const response = await send(`${origin}/vibe/runtime/config`, { version: VERSION, sourceCommit });
      if (!response.ok) { retryConfiguration(); return; }
      const text = await response.text();
      if (text.length > 16384) { retryConfiguration(); return; }
      const next = descriptorOf(JSON.parse(text), origin);
      if (stopped) return;
      if (!next) { retryConfiguration(); return; }
      configFailures = 0;
      descriptor = next;
      if (sampled === null) sampled = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 < next.sampleRate;
      if (sampled) installOnce();
      timeout(configure, Math.max(1000, next.expires - Date.now() - Math.min(60000, (next.expires - Date.now()) / 4)));
    } catch { if (!stopped) retryConfiguration(); }
  }
  const afterPaint = (fn) => {
    const one = requestAnimationFrame(() => { frames.delete(one); const two = requestAnimationFrame(() => { frames.delete(two); if (!stopped) fn(); }); frames.add(two); }); frames.add(one);
  };
  const reportLcp = () => {
    if (lcpReported || lcp === null || !finiteDuration(lcp.startTime)) return;
    lcpReported = true;
    record({ eventName: "web_vital", timestamp: observedAt(lcp.startTime), ...identity(), vitalName: "lcp", valueMs: rounded(lcp.startTime) });
  };
  const observe = (type, callback, extra = {}) => {
    try { const observer = new PerformanceObserver(callback); observer.observe({ type, buffered: true, ...extra }); observers.push(observer); } catch { /* Unsupported browser signal remains absent. */ }
  };
  let installed = false;
  function installOnce() {
    if (installed || stopped) return;
    installed = true;
    const navigation = () => {
      if (navigationReported) return;
      const entry = performance.getEntriesByType("navigation")[0];
      if (!entry || !finiteDuration(entry.duration) || entry.duration === 0) return;
      navigationReported = true;
      const ttfb = entry.responseStart - entry.requestStart;
      record({ eventName: "navigation", timestamp: observedAt(entry.startTime), traceId: activeTrace, spanId: activeSpan, durationMs: rounded(entry.duration), ...(finiteDuration(ttfb) ? { ttfbMs: rounded(ttfb) } : {}) });
    };
    if (document.readyState === "complete") navigation(); else listen(window, "load", () => timeout(navigation, 0), { once: true });
    observe("paint", (list) => { for (const entry of list.getEntries()) if (entry.name === "first-contentful-paint" && !fcpReported && finiteDuration(entry.startTime)) { fcpReported = true; record({ eventName: "web_vital", timestamp: observedAt(entry.startTime), ...identity(), vitalName: "fcp", valueMs: rounded(entry.startTime) }); } });
    observe("largest-contentful-paint", (list) => { for (const entry of list.getEntries()) lcp = { startTime: entry.startTime }; });
    listen(window, "error", (event) => { let type = "Error"; try { if (TYPES.has(event.error?.name)) type = event.error.name; } catch {} record({ eventName: "error", timestamp: new Date().toISOString(), ...identity(), errorType: type, ...(Number.isInteger(event.lineno) && event.lineno >= 0 && event.lineno <= 10000000 ? { line: event.lineno } : {}), ...(Number.isInteger(event.colno) && event.colno >= 0 && event.colno <= 10000000 ? { column: event.colno } : {}) }); });
    listen(window, "unhandledrejection", () => record({ eventName: "error", timestamp: new Date().toISOString(), ...identity(), errorType: "UnhandledRejection" }));
    // PerformanceEventTiming measures browser processing through the next paint.
    // Unsupported browsers do not receive an invented interaction duration.
    observe("event", (list) => {
      for (const entry of list.getEntries()) {
        const interactionType = entry.name === "click" ? "click" : entry.name === "submit" ? "submit" : entry.name === "keydown" ? "keyboard" : null;
        if (!interactionType || !entry.interactionId || !finiteDuration(entry.duration)) continue;
        const target = entry.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) continue;
        reportLcp();
        record({ eventName: "interaction", timestamp: observedAt(entry.startTime), ...identity(), durationMs: rounded(entry.duration), interactionType });
      }
    }, { durationThreshold: 16 });
    const requestFetch = function(input, init) {
      let measured = false, method = "GET";
      try { const request = input instanceof Request ? input : null; const url = new URL(request ? request.url : input, location.href); method = String(init?.method || request?.method || "GET").toUpperCase(); measured = url.origin === location.origin && !url.pathname.startsWith("/vibe/runtime/") && METHODS.has(method); } catch {}
      if (!measured) return originalFetch.apply(this, arguments);
      const start = performance.now(), id = identity();
      return originalFetch.apply(this, arguments).then((response) => { const duration = performance.now() - start; if (finiteDuration(duration) && response.status >= 100 && response.status <= 599) record({ eventName: "request", timestamp: observedAt(start), ...id, durationMs: rounded(duration), method, statusCode: response.status }); return response; }, (error) => { const duration = performance.now() - start; if (finiteDuration(duration)) record({ eventName: "request", timestamp: observedAt(start), ...id, durationMs: rounded(duration), method, networkError: true }); throw error; });
    };
    window.fetch = requestFetch;
    cleanups.push(() => { if (window.fetch === requestFetch) window.fetch = originalFetch; });
    const routeNavigation = () => { const start = performance.now(), id = begin(); afterPaint(() => { const duration = performance.now() - start; if (finiteDuration(duration)) record({ eventName: "navigation", timestamp: observedAt(start), ...id, durationMs: rounded(duration) }); }); };
    for (const name of ["pushState", "replaceState"]) { const original = history[name]; const wrapped = function() { const result = original.apply(this, arguments); routeNavigation(); return result; }; history[name] = wrapped; cleanups.push(() => { if (history[name] === wrapped) history[name] = original; }); }
    listen(window, "popstate", routeNavigation);
    listen(document, "visibilitychange", () => { if (document.hidden) { reportLcp(); void flush(true); } });
    listen(window, "pagehide", () => { reportLcp(); void flush(true); });
    const heartbeat = () => { void flush(); timeout(heartbeat, 10000); }; timeout(heartbeat, 10000);
  }
  void configure();
  return () => { stopped = true; queue = []; descriptor = null; for (const fn of cleanups.reverse()) fn(); for (const observer of observers) observer.disconnect(); for (const timer of timers) clearTimeout(timer); for (const frame of frames) cancelAnimationFrame(frame); for (const controller of controllers) controller.abort(); };
}
