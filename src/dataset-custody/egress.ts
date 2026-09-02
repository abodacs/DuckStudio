import type { CustodyKernel } from "./kernel";
import { MONITORED_TRANSPORTS } from "./schemas";

/**
 * Egress monitoring (§8.4; grilling 24): runtime interception over the five
 * monitored transports, armed at boot so zero dataset uploads are provable
 * from first paint. A dataset byte is a payload registered as derived from
 * preset relations or query results (the engine registers its results)
 * crossing a transport boundary; application-shell traffic stays outside
 * the accounting. Operational evidence, never a formal proof (PRODUCT.md
 * invariant 8) — the pinned limitation strings say so.
 *
 * No `egress-audit/` folder: the wrappers live here, the counters live in
 * the kernel (grilling 24).
 */

export interface EgressScope {
  readonly fetch?: unknown;
  readonly XMLHttpRequest?: unknown;
  readonly navigator?: { sendBeacon?: unknown };
  readonly WebSocket?: unknown;
  readonly WebTransport?: unknown;
}

export interface EgressMonitor {
  /** Transports actually wrapped in this scope; `monitoredTransports` reports this. */
  readonly monitoredTransports: readonly string[];
  /** Restores the original transports (test and lifecycle escape hatch). */
  disarm(): void;
}

interface DatagramWritable {
  getWriter(): { write(data: unknown): Promise<void> };
}

interface DatagramTransport {
  datagram: { writable: DatagramWritable };
}

function account(kernel: CustodyKernel, body: unknown): void {
  const bytes = kernel.datasetPayloadBytes(body);
  if (bytes > 0) kernel.recordDatasetUpload(bytes);
}

export function armEgressMonitoring(scope: EgressScope, kernel: CustodyKernel): EgressMonitor {
  const coverage: string[] = [];
  const restore: Array<() => void> = [];

  const wrap = <T>(owner: object, key: string, replacement: T, original: unknown): void => {
    (owner as Record<string, unknown>)[key] = replacement;
    restore.push(() => {
      (owner as Record<string, unknown>)[key] = original;
    });
  };

  // fetch: wrap the callable, accounting the request body.
  if (typeof scope.fetch === "function") {
    const originalFetch = scope.fetch as (...args: unknown[]) => Promise<unknown>;
    const monitored = (input: unknown, init?: { body?: unknown }) => {
      if (init && "body" in init) account(kernel, init.body);
      return originalFetch(input, init);
    };
    wrap(scope as object, "fetch", monitored, originalFetch);
    coverage.push("fetch");
  }

  // XMLHttpRequest: subclass so every `send` is accounted before dispatch.
  if (typeof scope.XMLHttpRequest === "function") {
    const Original = scope.XMLHttpRequest as new () => { send(body?: unknown): void };
    class MonitoredXMLHttpRequest extends Original {
      override send(body?: unknown): void {
        account(kernel, body);
        super.send(body);
      }
    }
    wrap(scope as object, "XMLHttpRequest", MonitoredXMLHttpRequest, Original);
    coverage.push("XMLHttpRequest");
  }

  // sendBeacon: wrap the navigator method, keeping `this` bound.
  if (scope.navigator && typeof scope.navigator.sendBeacon === "function") {
    const navigator = scope.navigator;
    const original = navigator.sendBeacon as (this: { sendBeacon: unknown }, url: unknown, data?: unknown) => boolean;
    const monitored = (url: unknown, data?: unknown) => {
      account(kernel, data);
      return original.call(navigator as { sendBeacon: unknown }, url, data);
    };
    wrap(navigator as object, "sendBeacon", monitored, original);
    coverage.push("sendBeacon");
  }

  // WebSocket: subclass so `send` is accounted.
  if (typeof scope.WebSocket === "function") {
    const Original = scope.WebSocket as new (url: unknown) => { send(data?: unknown): void };
    class MonitoredWebSocket extends Original {
      override send(data?: unknown): void {
        account(kernel, data);
        super.send(data);
      }
    }
    wrap(scope as object, "WebSocket", MonitoredWebSocket, Original);
    coverage.push("WebSocket");
  }

  // WebTransport: feature-detected (grilling 24) — wrapped only where the API
  // exists. Outgoing datagrams cross through `datagram.writable`, so the
  // wrapper intercepts the writers that transport hands out.
  if (typeof scope.WebTransport === "function") {
    const Original = scope.WebTransport as abstract new (url: unknown) => DatagramTransport;
    const MonitoredWebTransport = class extends Original {
      constructor(url: unknown) {
        super(url);
        const writable = this.datagram.writable;
        const originalGetWriter = writable.getWriter.bind(writable);
        writable.getWriter = () => {
          const writer = originalGetWriter();
          const originalWrite = writer.write.bind(writer);
          writer.write = (data: unknown) => {
            account(kernel, data);
            return originalWrite(data);
          };
          return writer;
        };
      }
    };
    wrap(scope as object, "WebTransport", MonitoredWebTransport, Original);
    coverage.push("WebTransport");
  }

  kernel.recordTransportCoverage(coverage);
  return {
    monitoredTransports: coverage,
    disarm() {
      for (const restoreFn of restore) restoreFn();
      restore.length = 0;
      kernel.recordTransportCoverage([]);
    },
  };
}

/** The transports the PRD pins as monitored; coverage is what `armEgressMonitoring` actually wrapped. */
export const EXPECTED_TRANSPORTS: readonly string[] = MONITORED_TRANSPORTS;
