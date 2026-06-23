import {
  defaultMetricsRegistry,
  type XiaopawMetricsRegistry,
} from "./metrics.ts";

export type MetricsServerOptions = {
  host?: string;
  port: number;
  registry?: XiaopawMetricsRegistry;
};

export function createMetricsResponse(
  request: Request,
  registry: XiaopawMetricsRegistry = defaultMetricsRegistry,
): Response {
  const started = performance.now();
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method !== "GET" || path !== "/metrics") {
    const response = new Response("Not Found", { status: 404 });
    safeRecordHttp(registry, request.method, path, response.status, performance.now() - started);
    return response;
  }

  safeRecordHttp(registry, request.method, path, 200, performance.now() - started);
  const response = new Response(registry.exportMetrics(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
  return response;
}

export function startMetricsServer(options: MetricsServerOptions): ReturnType<typeof Bun.serve> {
  const registry = options.registry ?? defaultMetricsRegistry;
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port,
    fetch: (request) => createMetricsResponse(request, registry),
  });
}

function safeRecordHttp(
  registry: XiaopawMetricsRegistry,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
): void {
  try {
    registry.recordHttpRequest({ method, path, statusCode, durationMs });
  } catch {
    // Observability must never break the HTTP path.
  }
}
