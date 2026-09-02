import { useEffect, useRef } from "react";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
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

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, MarkAreaComponent, TooltipComponent, CanvasRenderer]);

const ACCENT = "#00f2fe";
const AMBER = "#ffb347";
const INK_SECONDARY = "#9aa4b2";
const HAIRLINE = "rgb(255 255 255 / 9%)";

/**
 * Display-only rule, same spirit as kpi.ts's pinned table: a result column
 * whose name ends in `_pct` already carries a percentage number, so axis
 * ticks and tooltips append the unit. The raw value never changes in transit.
 */
function formatAxisValue(column: string | undefined, value: unknown): string {
  if (typeof value !== "number") return String(value);
  return column?.endsWith("_pct") ? `${value}%` : String(value);
}

/** The EvidenceChart body, rendered only after the dynamic import resolves. */
export default function EvidenceChart({ insights }: { insights: InsightsData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chart = insights.chart;
  const points = insights.points;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !chart) return;
    // The threshold is committed on the artifact's presentation spec (§4.3);
    // the envelope summary carries only the measured chart facts.
    const threshold = insights.spec.chart?.threshold;
    const instance = echarts.init(container);
    instance.setOption({
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 48, right: 16, top: 16, bottom: 32 },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgb(10 10 16 / 92%)",
        borderColor: HAIRLINE,
        textStyle: { color: "#e6edf3", fontSize: 11 },
        formatter: (params: { dataIndex: number }) => {
          const point = points[params.dataIndex];
          if (!point) return "";
          return [
            `${chart.x}: ${formatAxisValue(chart.x, point.x)}`,
            `${chart.y}: ${formatAxisValue(chart.y, point.y)}`,
          ].join("<br/>");
        },
      },
      // §4.5: scatter infers on two numeric columns, so its x axis is a
      // value axis; bar/line read a category x.
      xAxis: {
        type: chart.type === "scatter" ? "value" : "category",
        ...(chart.type === "scatter" ? {} : { data: points.map((point) => point.x) }),
        axisLabel: { color: INK_SECONDARY },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: INK_SECONDARY,
          formatter: (value: number) => formatAxisValue(chart.y, value),
        },
        splitLine: { lineStyle: { color: HAIRLINE } },
      },
      series: [
        {
          type: chart.type,
          data: points.map((point) => (chart.type === "scatter" ? [point.x, point.y] : point.y)),
          itemStyle: { color: chart.type === "line" ? AMBER : ACCENT },
          ...(chart.type === "line" ? { lineStyle: { color: AMBER } } : {}),
          // The committed threshold is a styling zone on the value x axis
          // (resolvePresentation refuses thresholds elsewhere); it never
          // gates release and it reads from the same spec the artifact
          // committed, not from chrome constants.
          ...(threshold
            ? {
                markArea: {
                  silent: true,
                  itemStyle: { color: "rgb(255 179 71 / 8%)" },
                  label: { color: AMBER, fontSize: 10, position: "insideTop" },
                  data: [[{ name: threshold.label ?? "", xAxis: threshold.value }, { xAxis: "max" }]],
                },
              }
            : {}),
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
