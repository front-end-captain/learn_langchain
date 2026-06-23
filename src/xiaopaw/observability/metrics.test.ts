import { describe, expect, it } from "bun:test";
import { createMetricsResponse } from "./metrics-server.ts";
import { XiaopawMetricsRegistry, routingKeyType } from "./metrics.ts";

describe("XiaopawMetricsRegistry", () => {
  it("exports counters, gauges and histograms in Prometheus text format", () => {
    const registry = new XiaopawMetricsRegistry();

    registry.recordFeishuEvent("im.message.receive_v1", "p2p");
    registry.recordInboundMessage("thread:oc:om", true);
    registry.setRunnerWorkerActive("group:oc", true);
    registry.setRunnerQueueSize("group:oc", 2);
    registry.recordHttpRequest({
      path: "/api/test/message",
      method: "POST",
      statusCode: 200,
      durationMs: 12,
    });
    registry.recordError("runner", "Error");

    const metrics = registry.exportMetrics();

    expect(metrics).toContain("# TYPE xiaopaw_feishu_events_total counter");
    expect(metrics).toContain('xiaopaw_feishu_events_total{chat_type="p2p",event_type="im.message.receive_v1"} 1');
    expect(metrics).toContain('xiaopaw_inbound_messages_total{has_attachment="true",routing_key_type="thread"} 1');
    expect(metrics).toContain('xiaopaw_runner_workers_active{routing_key_type="group"} 1');
    expect(metrics).toContain('xiaopaw_runner_queue_size{routing_key_type="group"} 2');
    expect(metrics).toContain('xiaopaw_http_requests_total{method="POST",path="/api/test/message",status_code="200"} 1');
    expect(metrics).toContain("xiaopaw_http_request_duration_seconds_bucket");
    expect(metrics).toContain('xiaopaw_errors_total{component="runner",error_type="Error"} 1');
  });

  it("classifies routing keys by type", () => {
    expect(routingKeyType("p2p:ou")).toBe("p2p");
    expect(routingKeyType("group:oc")).toBe("group");
    expect(routingKeyType("thread:oc:om")).toBe("thread");
    expect(routingKeyType("other")).toBe("unknown");
  });
});

describe("metrics server", () => {
  it("returns Prometheus metrics for GET /metrics", async () => {
    const registry = new XiaopawMetricsRegistry();
    registry.recordError("test", "ExampleError");

    const response = createMetricsResponse(
      new Request("http://127.0.0.1:9100/metrics"),
      registry,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("xiaopaw_errors_total");
  });

  it("includes the first /metrics scrape in an otherwise empty registry", async () => {
    const registry = new XiaopawMetricsRegistry();

    const response = createMetricsResponse(
      new Request("http://127.0.0.1:9100/metrics"),
      registry,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('xiaopaw_http_requests_total{method="GET",path="/metrics",status_code="200"} 1');
  });

  it("records 404 requests without throwing", async () => {
    const registry = new XiaopawMetricsRegistry();

    const response = createMetricsResponse(
      new Request("http://127.0.0.1:9100/nope"),
      registry,
    );

    expect(response.status).toBe(404);
    expect(registry.exportMetrics()).toContain('xiaopaw_http_requests_total{method="GET",path="/nope",status_code="404"} 1');
  });
});
