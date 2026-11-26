import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cacheHeaders, limits } from "./limits.mjs";

export function createGatewayServer(handle, {
  maxConnections = 32,
  maxActive = limits.concurrent,
  headerMs = 3500,
  writeMs = 2000,
  socketMs = 12_000,
  handshakesMs = 3500,
  tls,
  expectedHost,
  record = () => {},
} = {}) {
  const hosts = new Set(expectedHost ? [expectedHost] : []);
  if (expectedHost && !new URL("https://" + expectedHost).port) hosts.add(expectedHost + ":443");
  const sockets = new Map();
  const tcpSockets = new Set();
  const handshakes = new Map();
  let active = 0;

  async function respond(outgoing, state, response) {
    if (state.abort.signal.aborted || outgoing.destroyed) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    // The deadline lasts until socket close, including when Node has handed bytes
    // to its write queue. Reading a few more bytes does not extend it.
    const socket = outgoing.socket;
    state.writeTimer = setTimeout(() => {
      record("write_expired");
      socket.destroy();
    }, writeMs);
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), connection: "close" });
    record("response_" + Math.floor(response.status / 100) + "xx");
    if (response.body) {
      await pipeline(response.body, outgoing, { signal: state.abort.signal });
    } else {
      outgoing.end();
    }
  }

  const options = { headersTimeout: headerMs, requestTimeout: socketMs, maxHeaderSize: 8192 };
  const server = tls
    ? createHttpsServer({ ...options, ...tls, ALPNProtocols: ["http/1.1"] })
    : createServer(options);
  server.on("request", async (incoming, outgoing) => {
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
        record("exchange_limited");
        await respond(outgoing, state, new Response(null, { status: 503, headers: cacheHeaders }));
        return;
      }
      if (hosts.size && !hosts.has(incoming.headers.host?.toLowerCase())) {
        await respond(outgoing, state, new Response(null, { status: 421, headers: cacheHeaders }));
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
      await respond(outgoing, state, await handle(request, incoming.socket.remoteAddress));
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
  server.on("drop", () => record("connection_limited"));

  function trackRequestSocket(socket) {
    const state = {
      abort: new AbortController(),
      started: false,
      headerTimer: setTimeout(() => {
        record("headers_expired");
        socket.destroy();
      }, headerMs),
      socketTimer: setTimeout(() => {
        record("socket_expired");
        socket.destroy();
      }, socketMs),
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
  }

  function peerKey(socket) {
    return [socket.remoteAddress, socket.remotePort, socket.localAddress, socket.localPort].join("|");
  }

  server.on("connection", (socket) => {
    tcpSockets.add(socket);
    socket.once("close", () => tcpSockets.delete(socket));
    if (!tls) return trackRequestSocket(socket);

    // TLS exposes a different socket object after the handshake. The live TCP
    // endpoint tuple is the same on both and identifies the pending timer.
    const key = peerKey(socket);
    const timer = setTimeout(() => {
      record("handshake_expired");
      socket.destroy();
    }, handshakesMs);
    handshakes.set(key, timer);
    socket.once("close", () => {
      clearTimeout(timer);
      if (handshakes.get(key) === timer) handshakes.delete(key);
    });
  });

  if (tls) {
    server.on("secureConnection", (socket) => {
      const key = peerKey(socket);
      const timer = handshakes.get(key);
      if (timer === undefined) {
        socket.destroy();
        return;
      }
      clearTimeout(timer);
      handshakes.delete(key);
      trackRequestSocket(socket);
    });
  }

  server.shutdown = () => {
    server.close();
    for (const socket of sockets.keys()) socket.destroy();
    for (const socket of tcpSockets) socket.destroy();
  };
  return server;
}
