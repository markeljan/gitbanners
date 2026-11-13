"use no memo";

import type { Node } from "@/lib/banner/draw";
import type { HeatmapGeometry } from "@/lib/banner/types";

/** A finished arrangement: the canvas size and every leaf on it. */
export interface Layout {
  width: number;
  height: number;
  nodes: Node[];
  /** Geometry of the contribution graph, when one was drawn. */
  heatmap: HeatmapGeometry | null;
}
