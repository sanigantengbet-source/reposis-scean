"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScanArchitectureGraph, ScanGraphNode } from "@/types/scan";
import { cn } from "@/lib/utils";

interface ArchitectureGraphProps {
  graph?: ScanArchitectureGraph | null;
  onJumpToFinding?: (findingId?: string, filePath?: string) => void;
}

interface PositionedNode extends ScanGraphNode {
  x: number;
  y: number;
  radius: number;
  degree: number;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic constellation/force layout for repository import graphs.
 * Memoized outside render loop so filter changes never recompute node coordinates.
 */
function computeGraphLayout(graph: ScanArchitectureGraph): {
  nodes: PositionedNode[];
  nodeMap: Map<string, PositionedNode>;
  isSimplified: boolean;
} {
  const rawNodes = graph.nodes;
  const rawEdges = graph.edges;
  const n = rawNodes.length;
  const isSimplified = n >= 400 || Boolean(graph.truncated);

  const degreeMap = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of rawNodes) {
    degreeMap.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of rawEdges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  // Initial deterministic placement using golden angle + hub prioritization
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.max(260, Math.sqrt(n) * 42);

  const positioned: PositionedNode[] = rawNodes.map((node, idx) => {
    const deg = degreeMap.get(node.id) || 0;
    const hash = hashString(node.id);
    const normHash = (hash % 10000) / 10000;

    let distFactor = Math.sqrt((idx + 1) / Math.max(1, n));
    if (node.isEntry) {
      distFactor *= 0.35;
    } else if (node.isFlagged) {
      distFactor *= 0.55;
    } else if (node.isPackage) {
      distFactor = 0.65 + normHash * 0.35;
    }

    const angle = idx * goldenAngle + normHash * 0.4;
    const r = distFactor * spread;

    const radius = node.isEntry
      ? 5.5
      : node.isFlagged
        ? 4.8
        : node.isPackage
          ? 3.0
          : deg > 4
            ? 3.8
            : 2.8;

    return {
      ...node,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      radius,
      degree: deg,
    };
  });

  const nodeMap = new Map<string, PositionedNode>();
  for (const p of positioned) {
    nodeMap.set(p.id, p);
  }

  // Run fast bounded force relaxation to create organic clusters like ScanRepo
  const iterations = isSimplified ? 28 : n > 220 ? 50 : 85;
  const kRepel = isSimplified ? 900 : 1400;
  const kSpring = 0.045;
  const idealLen = 68;

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const maxStep = 18 * cooling;

    // Pairwise repulsion (sampled stride for large graphs to avoid O(N^2) lag)
    const stride = n > 350 ? 3 : n > 180 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = positioned[i];
      let fx = 0;
      let fy = 0;

      for (let j = (i + 1) % stride; j < n; j += stride) {
        if (i === j) continue;
        const b = positioned[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 25;
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = (kRepel * stride) / d2;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }

      // Mild gravity toward origin so orphan clusters stay in frame
      fx -= a.x * 0.012;
      fy -= a.y * 0.012;

      const stepX = Math.max(-maxStep, Math.min(maxStep, fx));
      const stepY = Math.max(-maxStep, Math.min(maxStep, fy));
      a.x += stepX;
      a.y += stepY;
    }

    // Spring attraction along import edges
    for (const edge of rawEdges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = edge.kind === "package" ? idealLen * 0.85 : idealLen;
      const force = (d - targetDist) * kSpring * cooling;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;

      src.x += fx * 0.5;
      src.y += fy * 0.5;
      tgt.x -= fx * 0.5;
      tgt.y -= fy * 0.5;
    }
  }

  return { nodes: positioned, nodeMap, isSimplified };
}

export function ArchitectureGraph({
  graph,
  onJumpToFinding,
}: ArchitectureGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isVisible, setIsVisible] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Transform state: zoom + pan
  const [userTransform, setUserTransform] = useState<{
    x: number;
    y: number;
    k: number;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const didMoveRef = useRef(false);
  const pinchStateRef = useRef<{
    dist: number;
    k: number;
    midX: number;
    midY: number;
  } | null>(null);

  // Debounce search input (Requirement 19)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim().toLowerCase());
    }, 180);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Lazy-render when section enters or approaches viewport (Requirement 19)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!graph || !graph.nodes || graph.nodes.length === 0) return null;
    return computeGraphLayout(graph);
  }, [graph]);

  const defaultFitTransform = useMemo(() => {
    if (!layout || layout.nodes.length === 0) {
      return { x: 0, y: 0, k: 1 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const graphW = Math.max(120, maxX - minX + 80);
    const graphH = Math.max(120, maxY - minY + 80);
    const k = Math.max(
      0.35,
      Math.min(1.5, Math.min(820 / graphW, 560 / graphH) * 0.88)
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      x: -cx * k,
      y: -cy * k,
      k,
    };
  }, [layout]);

  const transform = userTransform ?? defaultFitTransform;

  const setTransform = useCallback(
    (
      updater:
        | { x: number; y: number; k: number }
        | ((prev: { x: number; y: number; k: number }) => {
            x: number;
            y: number;
            k: number;
          })
    ) => {
      setUserTransform((prev) => {
        const base = prev ?? defaultFitTransform;
        return typeof updater === "function" ? updater(base) : updater;
      });
    },
    [defaultFitTransform]
  );

  const matchingNodeIds = useMemo(() => {
    if (!layout || !debouncedQuery) return null;
    const set = new Set<string>();
    for (const node of layout.nodes) {
      if (
        node.label.toLowerCase().includes(debouncedQuery) ||
        node.path.toLowerCase().includes(debouncedQuery)
      ) {
        set.add(node.id);
      }
    }
    return set;
  }, [layout, debouncedQuery]);

  const effectiveSelectedNodeId = useMemo(() => {
    if (selectedNodeId) return selectedNodeId;
    if (matchingNodeIds && matchingNodeIds.size === 1) {
      return matchingNodeIds.values().next().value ?? null;
    }
    return null;
  }, [selectedNodeId, matchingNodeIds]);

  const selectedNode = useMemo(() => {
    if (!layout || !effectiveSelectedNodeId) return null;
    return layout.nodeMap.get(effectiveSelectedNodeId) ?? null;
  }, [layout, effectiveSelectedNodeId]);

  const hoveredNode = useMemo(() => {
    if (!layout || !hoveredNodeId) return null;
    return layout.nodeMap.get(hoveredNodeId) ?? null;
  }, [layout, hoveredNodeId]);

  const connectedToSelected = useMemo(() => {
    const activeId = effectiveSelectedNodeId || hoveredNodeId;
    if (!graph || !activeId) return null;
    const set = new Set<string>([activeId]);
    for (const edge of graph.edges) {
      if (edge.source === activeId) set.add(edge.target);
      if (edge.target === activeId) set.add(edge.source);
    }
    return set;
  }, [graph, effectiveSelectedNodeId, hoveredNodeId]);

  const selectedNodeStats = useMemo(() => {
    if (!graph || !selectedNode) return { incoming: 0, outgoing: 0 };
    let incoming = 0;
    let outgoing = 0;
    for (const e of graph.edges) {
      if (e.source === selectedNode.id) outgoing++;
      if (e.target === selectedNode.id) incoming++;
    }
    return { incoming, outgoing };
  }, [graph, selectedNode]);

  const handleFitView = useCallback(() => {
    setUserTransform(null);
  }, []);

  // Canvas draw loop
  useEffect(() => {
    if (!isVisible || !layout || !graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    const height = Math.max(300, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear with deep charcoal background
    ctx.fillStyle = "#0e1013";
    ctx.fillRect(0, 0, width, height);

    // Subtle dot grid inside canvas matching ScanRepo screenshot
    const gridSpacing = 20;
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    for (let gx = 10; gx < width; gx += gridSpacing) {
      for (let gy = 10; gy < height; gy += gridSpacing) {
        ctx.fillRect(gx, gy, 1, 1);
      }
    }

    // Apply pan & zoom transform centered in canvas
    ctx.translate(width / 2 + transform.x, height / 2 + transform.y);
    ctx.scale(transform.k, transform.k);

    const activeId = selectedNodeId || hoveredNodeId;

    // 1. Draw edges
    for (const edge of graph.edges) {
      const src = layout.nodeMap.get(edge.source);
      const tgt = layout.nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const isHighlightedEdge =
        activeId && (edge.source === activeId || edge.target === activeId);

      const isDimmedBySearch =
        matchingNodeIds &&
        !matchingNodeIds.has(edge.source) &&
        !matchingNodeIds.has(edge.target);

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isHighlightedEdge) {
        ctx.strokeStyle =
          src.isFlagged || tgt.isFlagged
            ? "rgba(249, 115, 22, 0.85)"
            : "rgba(163, 230, 53, 0.9)";
        ctx.lineWidth = 1.4 / Math.sqrt(transform.k);
      } else if (isDimmedBySearch) {
        ctx.strokeStyle = "rgba(107, 114, 128, 0.07)";
        ctx.lineWidth = 0.6 / Math.sqrt(transform.k);
      } else if (src.isEntry || tgt.isEntry || edge.kind === "relative") {
        ctx.strokeStyle = "rgba(132, 204, 22, 0.42)";
        ctx.lineWidth = 0.85 / Math.sqrt(transform.k);
      } else {
        ctx.strokeStyle = "rgba(156, 163, 175, 0.24)";
        ctx.lineWidth = 0.75 / Math.sqrt(transform.k);
      }

      ctx.stroke();
    }

    // 2. Draw nodes
    for (const node of layout.nodes) {
      const isSelected = node.id === selectedNodeId;
      const isHovered = node.id === hoveredNodeId;
      const isSearchMatch = matchingNodeIds ? matchingNodeIds.has(node.id) : false;
      const isDimmed =
        (matchingNodeIds && !isSearchMatch) ||
        (connectedToSelected && !connectedToSelected.has(node.id));

      // Outer glow for entry, flagged, selected, or search-matched nodes
      if (
        (node.isEntry || node.isFlagged || isSelected || isSearchMatch) &&
        !isDimmed
      ) {
        ctx.beginPath();
        const glowRadius =
          (node.radius + (isSelected || isSearchMatch ? 6 : 4)) /
          Math.pow(transform.k, 0.25);
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        if (isSelected || isSearchMatch) {
          ctx.fillStyle = "rgba(250, 204, 21, 0.28)";
        } else if (node.isFlagged) {
          ctx.fillStyle = "rgba(249, 115, 22, 0.25)";
        } else {
          ctx.fillStyle = "rgba(163, 230, 53, 0.28)";
        }
        ctx.fill();
      }

      // Core node circle
      ctx.beginPath();
      const drawRadius =
        (node.radius + (isSelected || isHovered ? 1.5 : 0)) /
        Math.pow(transform.k, 0.2);
      ctx.arc(node.x, node.y, Math.max(1.8, drawRadius), 0, Math.PI * 2);

      if (node.isFlagged) {
        ctx.fillStyle = isDimmed ? "rgba(249, 115, 22, 0.25)" : "#f97316";
      } else if (node.isEntry) {
        ctx.fillStyle = isDimmed ? "rgba(163, 230, 53, 0.25)" : "#a3e635";
      } else if (node.isPackage) {
        ctx.fillStyle = isDimmed ? "rgba(107, 114, 128, 0.2)" : "#6b7280";
      } else {
        ctx.fillStyle = isDimmed ? "rgba(229, 231, 235, 0.2)" : "#e5e7eb";
      }
      ctx.fill();

      if (isSelected || isHovered || isSearchMatch) {
        ctx.lineWidth = 1.5 / Math.sqrt(transform.k);
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }

      // Draw labels when zoomed in or when selected/hovered/flagged in non-simplified mode
      const shouldShowLabel =
        isSelected ||
        isHovered ||
        isSearchMatch ||
        (transform.k >= 1.65 && (node.isEntry || node.isFlagged));

      if (shouldShowLabel) {
        const fontSize = Math.max(9, Math.min(12, 11 / Math.pow(transform.k, 0.3)));
        ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        ctx.fillStyle = isSelected || isHovered ? "#ffffff" : "#d1d5db";
        ctx.fillText(node.label, node.x + drawRadius + 4, node.y + 3);
      }
    }

    ctx.restore();
  }, [
    isVisible,
    layout,
    graph,
    transform,
    selectedNodeId,
    hoveredNodeId,
    matchingNodeIds,
    connectedToSelected,
  ]);

  const findNodeAtCanvasPoint = useCallback(
    (clientX: number, clientY: number): PositionedNode | null => {
      if (!layout || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2 - transform.x;
      const cy = clientY - rect.top - rect.height / 2 - transform.y;
      const worldX = cx / transform.k;
      const worldY = cy / transform.k;

      const hitTolerance = Math.max(10, 14 / transform.k);
      let closest: PositionedNode | null = null;
      let bestDist = hitTolerance;

      for (const node of layout.nodes) {
        const dx = node.x - worldX;
        const dy = node.y - worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= bestDist) {
          bestDist = dist;
          closest = node;
        }
      }
      return closest;
    },
    [layout, transform]
  );

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    didMoveRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didMoveRef.current = true;
      }
      setTransform((prev) => ({
        ...prev,
        x: dragStartRef.current.tx + dx,
        y: dragStartRef.current.ty + dy,
      }));
      return;
    }

    const hit = findNodeAtCanvasPoint(e.clientX, e.clientY);
    setHoveredNodeId(hit ? hit.id : null);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasDragging = isDraggingRef.current;
    isDraggingRef.current = false;
    if (wasDragging && !didMoveRef.current) {
      const hit = findNodeAtCanvasPoint(e.clientX, e.clientY);
      setSelectedNodeId(hit ? hit.id : null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setTransform((prev) => {
      const nextK = Math.max(0.25, Math.min(5, prev.k * zoomFactor));
      return {
        ...prev,
        k: nextK,
      };
    });
  };

  // Touch handlers (Pinch to zoom + drag + tap node — Requirement 15)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      pinchStateRef.current = {
        dist,
        k: transform.k,
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
      };
      isDraggingRef.current = false;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      isDraggingRef.current = true;
      didMoveRef.current = false;
      dragStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        tx: transform.x,
        ty: transform.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchStateRef.current) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / Math.max(1, pinchStateRef.current.dist);
      const nextK = Math.max(
        0.25,
        Math.min(5, pinchStateRef.current.k * scale)
      );
      setTransform((prev) => ({ ...prev, k: nextK }));
    } else if (e.touches.length === 1 && isDraggingRef.current) {
      const t = e.touches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        didMoveRef.current = true;
      }
      setTransform((prev) => ({
        ...prev,
        x: dragStartRef.current.tx + dx,
        y: dragStartRef.current.ty + dy,
      }));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    pinchStateRef.current = null;
    if (
      isDraggingRef.current &&
      !didMoveRef.current &&
      e.changedTouches.length === 1
    ) {
      const t = e.changedTouches[0];
      const hit = findNodeAtCanvasPoint(t.clientX, t.clientY);
      setSelectedNodeId(hit ? hit.id : null);
    }
    isDraggingRef.current = false;
  };

  // Fallback when graph is unavailable (Requirement 14 & 40)
  if (!graph || !layout || graph.nodes.length === 0) {
    return (
      <section
        id="architecture-section"
        aria-label="Architecture Graph"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      >
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-mono text-sm font-bold tracking-wider uppercase text-[var(--text-primary)]">
            ARCHITECTURE
          </h2>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-8 text-center text-xs font-mono text-[var(--text-secondary)]">
          Architecture graph unavailable for this scan result.
        </div>
      </section>
    );
  }

  return (
    <section
      id="architecture-section"
      ref={containerRef}
      aria-label="Architecture Graph"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden"
    >
      {/* Header + Legend + Controls */}
      <div className="border-b border-[var(--border-subtle)] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-base sm:text-lg font-bold tracking-widest uppercase text-[var(--text-primary)]">
                ARCHITECTURE
              </h2>
              {/* Decorative lime dot-matrix block matching visual reference */}
              <div
                aria-hidden="true"
                className="grid grid-cols-6 gap-0.5 rounded-xs bg-lime-500/10 p-1 border border-lime-500/30"
              >
                {Array.from({ length: 18 }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 w-1 rounded-full",
                      i % 3 === 0
                        ? "bg-lime-400"
                        : i % 2 === 0
                          ? "bg-lime-500/60"
                          : "bg-lime-500/25"
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Graph Legend with actual dynamic counts (Requirement 17) */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-[#a3e635] shadow-[0_0_8px_rgba(163,230,53,0.6)]"
                />
                <span>entry ({graph.counts.entry})</span>
              </span>

              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-[#f97316] shadow-[0_0_8px_rgba(249,115,22,0.6)]"
                />
                <span>flagged ({graph.counts.flagged})</span>
              </span>

              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-[#6b7280]"
                />
                <span>pkg ({graph.counts.pkg})</span>
              </span>
            </div>
          </div>

          {/* Search & Zoom Controls (Requirement 15 & 41) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search node..."
                aria-label="Search architecture graph node"
                className="h-8 pl-8 pr-7 text-xs font-mono bg-[var(--bg-canvas)]"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label="Clear node search"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() =>
                  setTransform((prev) => ({
                    ...prev,
                    k: Math.min(5, prev.k * 1.25),
                  }))
                }
                className="px-2 py-1 text-xs font-mono text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] rounded-xs transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() =>
                  setTransform((prev) => ({
                    ...prev,
                    k: Math.max(0.25, prev.k * 0.8),
                  }))
                }
                className="px-2 py-1 text-xs font-mono text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] rounded-xs transition-colors cursor-pointer"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Fit graph to viewport"
                onClick={handleFitView}
                className="px-2.5 py-1 text-xs font-mono text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] rounded-xs transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                <Maximize2 className="h-3 w-3" />
                <span>Fit</span>
              </button>
              <button
                type="button"
                aria-label="Reset graph view"
                onClick={() => {
                  setSelectedNodeId(null);
                  setSearchInput("");
                  handleFitView();
                }}
                className="px-2.5 py-1 text-xs font-mono text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] rounded-xs transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Large graph graceful degradation notice (Requirement 19) */}
        {layout.isSimplified && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-mono text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Large architecture graph — Simplified rendering enabled.
            </span>
          </div>
        )}
      </div>

      {/* Interactive Graph Viewport (Requirement 36: Desktop 600-750px, Tablet 500-650px, Mobile 500px min) */}
      <div className="relative w-full min-h-[500px] h-[500px] sm:h-[580px] lg:h-[650px] bg-[#0e1013] select-none overflow-hidden">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Interactive repository architecture graph with ${graph.counts.totalNodes} nodes and ${graph.counts.totalEdges} edges`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            isDraggingRef.current = false;
            setHoveredNodeId(null);
          }}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="h-full w-full block cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Hover Tooltip */}
        {hoveredNode && !selectedNode && (
          <div className="pointer-events-none absolute top-3 left-3 max-w-xs rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 px-3 py-2 text-xs font-mono shadow-lg backdrop-blur-xs">
            <div className="font-semibold text-[var(--text-primary)] break-all">
              {hoveredNode.path}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              {hoveredNode.isFlagged
                ? `${hoveredNode.findingsCount} finding(s) — click to inspect`
                : hoveredNode.isEntry
                  ? "Entry point module"
                  : hoveredNode.isPackage
                    ? "External package dependency"
                    : "Source file"}
            </div>
          </div>
        )}

        {/* Selected Node Details Overlay (Requirement 16) */}
        {selectedNode && (
          <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:w-96 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)]/95 p-4 text-xs shadow-xl backdrop-blur-md space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
                      selectedNode.isFlagged
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
                        : selectedNode.isEntry
                          ? "bg-lime-500/20 text-lime-400 border border-lime-500/40"
                          : selectedNode.isPackage
                            ? "bg-zinc-500/20 text-zinc-300 border border-zinc-500/40"
                            : "bg-zinc-700/40 text-zinc-200 border border-zinc-600"
                    )}
                  >
                    {selectedNode.isEntry && selectedNode.isFlagged
                      ? "entry · flagged"
                      : selectedNode.isEntry
                        ? "entry"
                        : selectedNode.isFlagged
                          ? "flagged"
                          : selectedNode.isPackage
                            ? "pkg"
                            : "module"}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {selectedNodeStats.outgoing} out · {selectedNodeStats.incoming} in
                  </span>
                </div>
                <div className="font-mono font-semibold text-[var(--text-primary)] break-all">
                  {selectedNode.path}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close node details"
                onClick={() => setSelectedNodeId(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedNode.findingsCount > 0 ||
            selectedNode.findings.length > 0 ? (
              <div className="space-y-2 border-t border-[var(--border-subtle)] pt-2.5">
                <div className="text-[11px] font-mono text-orange-400">
                  {selectedNode.findings.length || selectedNode.findingsCount}{" "}
                  security finding(s) in this module:
                </div>
                {selectedNode.findings.slice(0, 2).map((f, idx) => (
                  <div
                    key={`${f.ruleId || idx}`}
                    className="rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="font-semibold text-[var(--text-primary)]">
                      {f.title}
                    </div>
                    {f.ruleId && (
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        {f.ruleId}
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    onJumpToFinding?.(
                      selectedNode.findingIds[0],
                      selectedNode.path
                    )
                  }
                  className="w-full justify-between font-mono text-xs"
                >
                  <span>Jump to finding</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                <ShieldCheck className="h-4 w-4 text-lime-400 shrink-0" />
                <span>No security findings associated with this node.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Accessible Keyboard Node Strip for Flagged / Entry Nodes (Requirement 41) */}
      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 px-4 py-2.5 flex items-center gap-2 overflow-x-auto">
        <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0">
          Quick inspect:
        </span>
        {layout.nodes
          .filter((n) => n.isFlagged || n.isEntry)
          .slice(0, 10)
          .map((node) => (
            <button
              key={node.id}
              type="button"
              aria-label={`Inspect ${node.isFlagged ? "flagged" : "entry"} node ${node.path}`}
              onClick={() => setSelectedNodeId(node.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-mono whitespace-nowrap transition-colors cursor-pointer",
                selectedNodeId === node.id
                  ? "border-amber-400 bg-amber-500/15 text-[var(--text-primary)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  node.isFlagged ? "bg-orange-400" : "bg-lime-400"
                )}
              />
              <span>{node.label}</span>
            </button>
          ))}
      </div>

      {/* Graph Footer (Requirement 18) */}
      <div className="border-t border-[var(--border-subtle)] px-4 sm:px-5 py-3 text-xs font-mono text-[var(--text-muted)]">
        {/* Desktop Footer */}
        <div className="hidden sm:flex items-center justify-between gap-4">
          <span>
            {graph.counts.totalNodes} nodes · {graph.counts.totalEdges} edges
          </span>
          <span>scroll to zoom · click node to jump to finding</span>
        </div>
        {/* Mobile Footer */}
        <div className="flex sm:hidden flex-col gap-1">
          <span>
            {graph.counts.totalNodes} nodes · {graph.counts.totalEdges} edges
          </span>
          <span>Pinch to zoom · Tap node for details</span>
        </div>
      </div>
    </section>
  );
}
