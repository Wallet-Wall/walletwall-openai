import { timingSafeEqual } from "node:crypto";
import { Worker } from "node:worker_threads";
import workerSource from "walletwall:worker";
import { createAdmission } from "./admission.mjs";
import { cacheHeaders, limits } from "./limits.mjs";

const originKeyHeader = "x-walletwall-origin-key";
const keyPattern = /^[a-f0-9]{64}$/;
const originResponseHeader = "x-walletwall-mcp";

const failures = {
  disabled: [503, "Service unavailable."],
  route: [404, "Route not found."],
  origin: [403, "Origin not permitted."],
  methods: [405, "Method not allowed."],
  media: [415, "Content-Type must be application/json."],
  accept: [406, "Both application/json and text/event-stream must be accepted."],
  oversized: [413, "Request exceeds the service limit."],
  timeout: [408, "Request body deadline exceeded."],
  malformed: [400, "Invalid request body."],
  busy: [429, "Admission limit reached."],
  execution: [504, "Execution deadline exceeded."],
  cancelled: [408, "Request cancelled."],
  internal: [502, "Service could not complete the request."],
};

function rejection(reason) {
  const [status, message] = failures[reason];
  const headers = { ...cacheHeaders, "content-type": "application/json" };
  if (status === 405) headers.allow = "POST";
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }), { status, headers });
}

async function readBody(body, signal, maxBytes, timeoutMs, size) {
  if (!body) return { reason: "malformed" };
  if (signal.aborted) return { reason: "cancelled" };
  const reader = body.getReader();
  let deadline;
  let detach;
  const stopped = new Promise((resolve) => {
    deadline = setTimeout(() => resolve({ reason: "timeout" }), timeoutMs);
    const cancel = () => resolve({ reason: "cancelled" });
    signal.addEventListener("abort", cancel, { once: true });
    detach = () => signal.removeEventListener("abort", cancel);
  });
  const chunks = [];
  let length = 0;
  let finished = false;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), stopped]);
      if (next.reason) return next;
      if (next.done) {
        finished = true;
        break;
      }
      length += next.value.byteLength;
      if (length > maxBytes) return { reason: "oversized" };
      chunks.push(next.value);
    }
    if (size !== undefined && size !== length) return { reason: "malformed" };
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes };
  } catch {
    return { reason: "malformed" };
  } finally {
    clearTimeout(deadline);
    detach();
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function execute(body, headers, signal, evaluationMs = limits.evaluationMs, workerUrl = workerSource) {
  if (signal.aborted) return Promise.resolve(rejection("cancelled"));
  return new Promise((resolve) => {
    const worker = new Worker(new URL(workerUrl), {
      workerData: { body, headers }, transferList: [body.buffer],
      stdout: true, stderr: true, execArgv: [], env: {},
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    worker.stdout?.resume();
    worker.stderr?.resume();
    let done = false;
    const timer = setTimeout(() => { void finish(rejection("execution")); }, evaluationMs);
    const abort = () => { void finish(rejection("cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    async function finish(response) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      try {
        await worker.terminate();
      } catch {
        resolve(rejection("internal"));
        return;
      }
      resolve(response);
    }
    worker.once("error", () => { void finish(rejection("internal")); });
    worker.once("exit", () => { void finish(rejection("internal")); });
    worker.once("message", (value) => {
      const response = new Response(value.body, {
        status: value.status,
        headers: { ...cacheHeaders, ...(value.type && { "content-type": value.type }) },
      });
      void finish(response);
    });
  });
}

function supportsJson(request) {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const encoding = request.headers.get("content-encoding")?.toLowerCase();
  return type === "application/json" && (encoding === undefined || encoding === "identity");
}

function acceptsMcp(request) {
  const accept = request.headers.get("accept");
  if (!accept) return false;
  const formats = new Set();
  for (const item of accept.split(",")) {
    const [type, ...parameters] = item.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    if (quality === undefined || Number(quality.trim().slice(2)) > 0) formats.add(type.trim());
  }
  return formats.has("application/json") && formats.has("text/event-stream");
}

function checkedLength(request) {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  return /^\d{1,16}$/.test(value) ? Number(value) : NaN;
}

function matchesKey(request, key) {
  const value = request.headers.get(originKeyHeader);
  return typeof value === "string" && keyPattern.test(value) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(key, "hex"));
}

export function createHandler({
  enabled = true,
  path = "/mcp",
  allowedOrigins = [],
  originKey,
  admit = createAdmission(),
  dispatch = execute,
} = {}) {
  if (originKey !== undefined && !keyPattern.test(originKey)) throw Error("Invalid origin credential configuration.");
  const origins = new Set(allowedOrigins);
  return async (request) => {
    if (!enabled) return rejection("disabled");
    if (originKey && !matchesKey(request, originKey)) return rejection("origin");

    const url = new URL(request.url);
    if (url.pathname !== path || url.search || url.hash) return rejection("route");
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin)) return rejection("origin");
    if (request.method !== "POST") return rejection("methods");
    if (!supportsJson(request)) return rejection("media");
    if (!acceptsMcp(request)) return rejection("accept");
    const length = checkedLength(request);
    if (Number.isNaN(length)) return rejection("malformed");
    if (length > limits.requestBytes) return rejection("oversized");

    const release = admit();
    if (!release) return rejection("busy");
    try {
      const body = await readBody(request.body, request.signal, limits.requestBytes, limits.bodyMs, length);
      if (body.reason) return rejection(body.reason);
      const version = request.headers.get("mcp-protocol-version");
      if (version !== null && version.length > 32) return rejection("malformed");
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(version !== null && { "mcp-protocol-version": version }),
      };
      return await dispatch(body.bytes, headers, request.signal);
    } catch {
      return rejection("internal");
    } finally {
      release();
    }
  };
}

/** The public gateway's only outbound destination is its operator-configured Vercel origin. */
export function createForwarder({ url, originKey, protectionBypass, request = fetch }) {
  const target = new URL(url);
  if (target.protocol !== "https:" || !/^[a-z0-9-]+\.vercel\.app$/.test(target.hostname) ||
      target.port || target.username || target.password || target.pathname !== "/api/mcp" || target.search || target.hash ||
      !keyPattern.test(originKey) || typeof protectionBypass !== "string" || protectionBypass.length < 20 ||
      !/^[a-zA-Z0-9_-]+$/.test(protectionBypass)) {
    throw Error("Invalid protected Vercel origin configuration.");
  }
  return async (body, headers, signal) => {
    const deadline = AbortSignal.timeout(limits.forwardMs);
    const forwardedSignal = AbortSignal.any([signal, deadline]);
    try {
      const response = await request(target.href, {
        method: "POST", redirect: "error", cache: "no-store", signal: forwardedSignal, body,
        headers: { ...headers, [originKeyHeader]: originKey, "x-vercel-protection-bypass": protectionBypass },
      });
      if (response.headers.get(originResponseHeader) !== "1") {
        void response.body?.cancel().catch(() => {});
        return rejection("internal");
      }
      if (response.status === 202) return new Response(null, { status: 202, headers: cacheHeaders });
      if (!response.headers.get("content-type")?.startsWith("application/json")) {
        void response.body?.cancel().catch(() => {});
        return rejection("internal");
      }
      const result = await readBody(response.body, forwardedSignal, limits.responseBytes, limits.forwardMs);
      if (result.reason) return rejection("internal");
      return new Response(result.bytes, { status: response.status, headers: { ...cacheHeaders, "content-type": "application/json" } });
    } catch {
      if (signal.aborted) return rejection("cancelled");
      return rejection(deadline.aborted ? "execution" : "internal");
    }
  };
}

/** Used only for the separately gated Vercel origin. Invalid or missing config stays closed. */
export function createOriginHandler({ enabled, originKey } = {}) {
  if (!enabled || typeof originKey !== "string" || !keyPattern.test(originKey)) {
    return () => rejection("disabled");
  }
  const handle = createHandler({ path: "/api/mcp", originKey });
  return async (request) => {
    const response = await handle(request);
    response.headers.set(originResponseHeader, "1");
    return response;
  };
}
export { createAdmission, limits };
