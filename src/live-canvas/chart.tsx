import { useEffect, useRef } from "react";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { InsightsData } from "../revisioned-workspace/projection";

/**
 * The lazy ECharts boundary (ADR 0007, grilling 52): this module is the only
 * echarts importer in the tree — the Insights view pulls it in through
 * `lazy()`, so Vite splits the chart bundle into its own chunk (no
 * manualChunks; the dynamic import is the boundary) and a user pays for
 * ECharts only when a chart actually renders.
 */

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, CanvasRenderer]);

const ACCENT = "#00f2fe";
const AMBER = "#ffb347";

/** The EvidenceChart body, rendered only after the dynamic import resolves. */
export default function EvidenceChart({ insights }: { insights: InsightsData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chart = insights.chart;
  const points = insights.points;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !chart) return;
    const instance = echarts.init(container);
    instance.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 48, right: 16, top: 16, bottom: 32 },
      // §4.5: scatter infers on two numeric columns, so its x axis is a
      // value axis; bar/line read a category x.
      xAxis: {
        type: chart.type === "scatter" ? "value" : "category",
        ...(chart.type === "scatter" ? {} : { data: points.map((point) => point.x) }),
        axisLabel: { color: "#9aa4b2" },
      },
      yAxis: { type: "value", axisLabel: { color: "#9aa4b2" }, splitLine: { lineStyle: { color: "rgb(255 255 255 / 9%)" } } },
      series: [
        {
          type: chart.type,
          data: points.map((point) => (chart.type === "scatter" ? [point.x, point.y] : point.y)),
          itemStyle: { color: chart.type === "line" ? AMBER : ACCENT },
          ...(chart.type === "line" ? { lineStyle: { color: AMBER } } : {}),
        },
      ],
    });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => instance.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      instance.dispose();
    };
  }, [chart, points]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`${chart?.type ?? "chart"} chart of ${chart?.y ?? "values"} by ${chart?.x ?? "categories"}`}
      className="h-56 w-full"
    />
  );
}
