import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cacheHeaders, limits } from "./limits.mjs";

export function createGatewayServer(handle, {
  maxConnections = 32,
  maxActive = limits.concurrent,
  headerMs = 3500,
  writeMs = 2000,
  socketMs = 12_000,
} = {}) {
  const sockets = new Map();
  let active = 0;

  async function respond(outgoing, state, response) {
    if (state.abort.signal.aborted || outgoing.destroyed) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    // The deadline lasts until socket close, including when Node has handed bytes
    // to its write queue. Reading a few more bytes does not extend it.
    const socket = outgoing.socket;
    state.writeTimer = setTimeout(() => socket.destroy(), writeMs);
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), connection: "close" });
    if (response.body) {
      await pipeline(response.body, outgoing, { signal: state.abort.signal });
    } else {
      outgoing.end();
    }
  }

  const server = createServer({
    headersTimeout: headerMs,
    requestTimeout: socketMs,
    maxHeaderSize: 8192,
  }, async (incoming, outgoing) => {
    const state = sockets.get(incoming.socket);
    if (!state || state.started) {
      incoming.socket.destroy();
      return;
    }
    state.started = true;
    clearTimeout(state.headerTimer);
    outgoing.shouldKeepAlive = false;
    const admitted = active < maxActive;
    if (admitted) active++;

    try {
      if (!admitted) {
        await respond(outgoing, state, new Response(null, { status: 503, headers: cacheHeaders }));
        return;
      }
      if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
        await respond(outgoing, state, new Response(null, { status: 400, headers: cacheHeaders }));
        return;
      }
      const hasBody = !["GET", "HEAD"].includes(incoming.method);
      const request = new Request(new URL(incoming.url, "http://127.0.0.1"), {
        method: incoming.method, headers: incoming.headers, signal: state.abort.signal,
        ...(hasBody && { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      await respond(outgoing, state, await handle(request));
    } catch {
      if (!outgoing.headersSent && !outgoing.destroyed && !state.abort.signal.aborted) {
        clearTimeout(state.writeTimer);
        try {
          await respond(outgoing, state, new Response(null, { status: 500, headers: cacheHeaders }));
        } catch {
          outgoing.destroy();
        }
      } else {
        outgoing.destroy();
      }
    } finally {
      // A slot covers the handler and writer together. A disconnect aborts the
      // handler, but cannot release its slot while cleanup still holds resources.
      if (admitted) {
        await state.closed;
        active--;
      }
    }
  });

  server.maxConnections = maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on("dropRequest", (_, socket) => socket.destroy());
  server.on("connection", (socket) => {
    const state = {
      abort: new AbortController(),
      started: false,
      headerTimer: setTimeout(() => socket.destroy(), headerMs),
      socketTimer: setTimeout(() => socket.destroy(), socketMs),
      writeTimer: undefined,
      closed: new Promise((resolve) => socket.once("close", resolve)),
    };
    sockets.set(socket, state);
    socket.once("close", () => {
      clearTimeout(state.headerTimer);
      clearTimeout(state.socketTimer);
      clearTimeout(state.writeTimer);
      sockets.delete(socket);
      state.abort.abort();
    });
  });
  return server;
}
