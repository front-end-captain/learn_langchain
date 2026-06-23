type LabelValue = string | number | boolean | null | undefined;

type MetricSample = {
  name: string;
  help: string;
  type: "counter" | "gauge";
  labels: Record<string, string>;
  value: number;
};

type HistogramSample = {
  name: string;
  help: string;
  labels: Record<string, string>;
  buckets: Map<number, number>;
  sum: number;
  count: number;
};

const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class XiaopawMetricsRegistry {
  private readonly counters = new Map<string, MetricSample>();

  private readonly gauges = new Map<string, MetricSample>();

  private readonly histograms = new Map<string, HistogramSample>();

  recordFeishuEvent(eventType: string, chatType: string | null | undefined): void {
    this.incCounter(
      "xiaopaw_feishu_events_total",
      "Number of Feishu events received via WebSocket",
      {
        event_type: eventType || "unknown",
        chat_type: chatType || "unknown",
      },
    );
  }

  recordInboundMessage(routingKey: string, hasAttachment: boolean): void {
    this.incCounter(
      "xiaopaw_inbound_messages_total",
      "Number of InboundMessage objects dispatched to Runner",
      {
        routing_key_type: routingKeyType(routingKey),
        has_attachment: hasAttachment ? "true" : "false",
      },
    );
  }

  setRunnerWorkerActive(routingKey: string, active: boolean): void {
    this.setGauge(
      "xiaopaw_runner_workers_active",
      "Number of active per-routing_key workers in Runner",
      { routing_key_type: routingKeyType(routingKey) },
      active ? 1 : 0,
    );
  }

  setRunnerQueueSize(routingKey: string, size: number): void {
    this.setGauge(
      "xiaopaw_runner_queue_size",
      "Queue size per routing_key in Runner",
      { routing_key_type: routingKeyType(routingKey) },
      size,
    );
  }

  recordHttpRequest(input: {
    path: string;
    method: string;
    statusCode: number;
    durationMs?: number;
  }): void {
    this.incCounter(
      "xiaopaw_http_requests_total",
      "HTTP requests handled by TestAPI and metrics endpoints",
      {
        path: input.path,
        method: input.method,
        status_code: String(input.statusCode),
      },
    );

    if (input.durationMs !== undefined) {
      this.observeHistogram(
        "xiaopaw_http_request_duration_seconds",
        "HTTP request duration in seconds",
        {
          path: input.path,
          method: input.method,
        },
        input.durationMs / 1000,
      );
    }
  }

  recordError(component: string, errorType: string | null | undefined): void {
    this.incCounter(
      "xiaopaw_errors_total",
      "Errors encountered by various components",
      {
        component,
        error_type: errorType || "unknown",
      },
    );
  }

  exportMetrics(): string {
    const lines: string[] = [];
    appendSamples(lines, [...this.counters.values()]);
    appendSamples(lines, [...this.gauges.values()]);
    appendHistograms(lines, [...this.histograms.values()]);
    return `${lines.join("\n")}\n`;
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private incCounter(
    name: string,
    help: string,
    labels: Record<string, LabelValue>,
    amount = 1,
  ): void {
    const normalized = normalizeLabels(labels);
    const key = metricKey(name, normalized);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += amount;
      return;
    }
    this.counters.set(key, {
      name,
      help,
      type: "counter",
      labels: normalized,
      value: amount,
    });
  }

  private setGauge(
    name: string,
    help: string,
    labels: Record<string, LabelValue>,
    value: number,
  ): void {
    const normalized = normalizeLabels(labels);
    this.gauges.set(metricKey(name, normalized), {
      name,
      help,
      type: "gauge",
      labels: normalized,
      value,
    });
  }

  private observeHistogram(
    name: string,
    help: string,
    labels: Record<string, LabelValue>,
    value: number,
  ): void {
    const normalized = normalizeLabels(labels);
    const key = metricKey(name, normalized);
    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = {
        name,
        help,
        labels: normalized,
        buckets: new Map(HTTP_DURATION_BUCKETS.map((bucket) => [bucket, 0])),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, histogram);
    }

    for (const bucket of HTTP_DURATION_BUCKETS) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) ?? 0) + 1);
      }
    }
    histogram.sum += value;
    histogram.count += 1;
  }
}

export const defaultMetricsRegistry = new XiaopawMetricsRegistry();

export function routingKeyType(routingKey: string): "p2p" | "group" | "thread" | "unknown" {
  if (routingKey.startsWith("p2p:")) {
    return "p2p";
  }
  if (routingKey.startsWith("group:")) {
    return "group";
  }
  if (routingKey.startsWith("thread:")) {
    return "thread";
  }
  return "unknown";
}

export function exportMetrics(
  registry: XiaopawMetricsRegistry = defaultMetricsRegistry,
): string {
  return registry.exportMetrics();
}

function appendSamples(lines: string[], samples: MetricSample[]): void {
  const emitted = new Set<string>();
  for (const sample of samples) {
    if (!emitted.has(sample.name)) {
      lines.push(`# HELP ${sample.name} ${sample.help}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
      emitted.add(sample.name);
    }
    lines.push(`${sample.name}${formatLabels(sample.labels)} ${sample.value}`);
  }
}

function appendHistograms(lines: string[], histograms: HistogramSample[]): void {
  const emitted = new Set<string>();
  for (const histogram of histograms) {
    if (!emitted.has(histogram.name)) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      emitted.add(histogram.name);
    }
    for (const [bucket, count] of histogram.buckets.entries()) {
      lines.push(
        `${histogram.name}_bucket${formatLabels({ ...histogram.labels, le: String(bucket) })} ${count}`,
      );
    }
    lines.push(
      `${histogram.name}_bucket${formatLabels({ ...histogram.labels, le: "+Inf" })} ${histogram.count}`,
    );
    lines.push(`${histogram.name}_sum${formatLabels(histogram.labels)} ${histogram.sum}`);
    lines.push(`${histogram.name}_count${formatLabels(histogram.labels)} ${histogram.count}`);
  }
}

function normalizeLabels(labels: Record<string, LabelValue>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value == null ? "unknown" : String(value)]),
  );
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${name}:${JSON.stringify(labels)}`;
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
