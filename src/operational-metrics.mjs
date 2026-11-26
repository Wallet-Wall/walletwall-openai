import { limits } from "./limits.mjs";

const events = [
  "admitted", "aggregate_limited", "window_limited", "source_limited", "source_capacity", "invalid_peer",
  "connection_limited", "exchange_limited", "handshake_expired", "headers_expired", "socket_expired",
  "write_expired", "response_2xx", "response_4xx", "response_5xx",
];

export function createOperationalMetrics(write = (line) => console.log(line)) {
  const counters = Object.fromEntries(events.map((event) => [event, 0]));

  function emit(reason) {
    write(JSON.stringify({
      event: "walletwall_metrics",
      reason,
      remaining: limits.admissionsPerBoot - counters.admitted,
      counters,
    }));
  }

  return {
    record(event) {
      if (!Object.hasOwn(counters, event)) return;
      counters[event]++;
      if (event === "admitted" && [0.7, 0.9].some((fraction) => counters.admitted === limits.admissionsPerBoot * fraction)) {
        emit("lease_threshold");
      }
    },
    snapshot() { emit("operator_snapshot"); },
    shutdown() { emit("shutdown"); },
  };
}
