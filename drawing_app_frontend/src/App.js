import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * Responsive Drawing Studio
 *
 * Step 01.04 scope:
 * - Ensure clear-canvas is fully implemented and integrated with undo/redo history
 * - Export/download PNG (dependency-light), with minimal user feedback
 *
 * Implementation notes:
 * - History stores ImageData snapshots in *device pixel* space (canvas.width/height).
 * - A snapshot is committed at the end of each stroke (pointer up/cancel/leave),
 *   and when clearing the canvas.
 * - We fill white behind pixels (destination-over) after restores/resizes/exports
 *   so export is consistently white-background.
 */

// PUBLIC_INTERFACE
function App() {
  /** UI state */
  const [brushSize, setBrushSize] = useState(12);
  const [brushColor, setBrushColor] = useState("#3b82f6");
  const [isEraser, setIsEraser] = useState(false);

  /** Responsive toolbar */
  const [toolbarOpen, setToolbarOpen] = useState(true);

  /** Minimal status/user feedback (kept simple; no toasts/deps). */
  const [statusText, setStatusText] = useState("");

  /**
   * History UI state (derived from refs but kept in state so React can render disabled states).
   * historyIndex is the index of the "current" snapshot within historyRef.current.
   */
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historySize, setHistorySize] = useState(0);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  /** Drawing state kept in refs to avoid re-rendering on every pointer move. */
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const activePointerIdRef = useRef(null);

  /** Used for resizing while preserving existing pixels. */
  const snapshotRef = useRef(null);

  /**
   * History model:
   * - historyRef: array of { imageData, width, height }
   * - historyIndexRef: current index into the array
   *
   * We keep the canonical model in refs so keyboard handlers can access
   * the latest values without depending on state closures.
   */
  const historyRef = useRef([]);
  const historyIndexRef = useRef(0);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historySize - 1;

  // Prevent actions that would be surprising mid-stroke.
  const isBusy = isDrawingRef.current;

  const activeColor = useMemo(() => (isEraser ? "#ffffff" : brushColor), [isEraser, brushColor]);

  /**
   * Fill behind existing pixels: destination-over only affects transparent pixels.
   * We use this after restores/resize/export to keep background white for PNG.
   */
  const ensureBackgroundWhite = (ctx, cssWidth, cssHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.restore();
  };

  /**
   * Set a short-lived status line (auto clears).
   * This is intentionally minimal and dependency-free.
   */
  const setTransientStatus = (text, ms = 1600) => {
    setStatusText(text);
    if (ms <= 0) return;
    window.setTimeout(() => setStatusText((curr) => (curr === text ? "" : curr)), ms);
  };

  /**
   * Create a snapshot in device pixel space (canvas.width/height).
   * Returns null if canvas/ctx not available.
   */
  const snapshotCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { imageData, width: canvas.width, height: canvas.height };
    } catch {
      return null;
    }
  };

  /**
   * Push a new snapshot onto the history stack.
   * - If we are not at the end, truncate redo states.
   * - Avoid pushing duplicates (pixel compare is expensive); we commit at stroke end / clear.
   */
  const commitHistorySnapshot = () => {
    const snap = snapshotCanvas();
    if (!snap) return;

    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push(snap);

    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;

    setHistorySize(nextHistory.length);
    setHistoryIndex(historyIndexRef.current);
  };

  /**
   * Restore a snapshot into the canvas.
   * Important: putImageData works in device pixels, and will overwrite all pixels.
   * After restoring, we re-apply CSS coordinate transform and fill white behind.
   */
  const restoreHistorySnapshot = (snap) => {
    const canvas = canvasRef.current;
    if (!canvas || !snap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // If snapshot dimensions differ (e.g., after big resize), scale it into the current canvas.
    if (snap.width !== canvas.width || snap.height !== canvas.height) {
      const temp = document.createElement("canvas");
      temp.width = snap.width;
      temp.height = snap.height;
      const tctx = temp.getContext("2d");
      if (!tctx) return;
      tctx.putImageData(snap.imageData, 0, 0);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(temp, 0, 0, snap.width, snap.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.putImageData(snap.imageData, 0, 0);
      ctx.restore();
    }

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ensureBackgroundWhite(ctx, cssWidth, cssHeight);
  };

  /**
   * Translate a PointerEvent's client coordinates into CSS pixel coordinates
   * within the canvas. This stays correct even if canvas is scaled via CSS.
   */
  const getCanvasPointFromEvent = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp to canvas bounds to avoid odd strokes outside.
    const clampedX = Math.min(Math.max(0, x), rect.width);
    const clampedY = Math.min(Math.max(0, y), rect.height);
    return { x: clampedX, y: clampedY };
  };

  /**
   * Configure stroke style for the current mode.
   * For erasing we use `destination-out` so it truly erases.
   */
  const applyStrokeStyle = (ctx) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;

    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = brushColor;
    }
  };

  /**
   * Draw a line segment in CSS pixel space.
   * Canvas context is scaled to CSS pixels via ctx.setTransform(dpr,0,0,dpr,0,0),
   * so we can draw using CSS coordinates directly.
   */
  const drawSegment = (from, to) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    applyStrokeStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  /** Paint a single dot (for taps/clicks without movement). */
  const drawDot = (at) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    applyStrokeStyle(ctx);
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(0.5, brushSize / 2), 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? "rgba(0,0,0,1)" : brushColor;
    ctx.fill();
    ctx.restore();
  };

  // Keep a crisp canvas in the available container space (DPR aware) and preserve content on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const snapshot = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { imageData, width: canvas.width, height: canvas.height };
      } catch {
        return null;
      }
    };

    const restoreSnapshot = (snap, dpr, cssWidth, cssHeight) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !snap) return;

      const temp = document.createElement("canvas");
      temp.width = snap.width;
      temp.height = snap.height;
      const tctx = temp.getContext("2d");
      if (!tctx) return;
      tctx.putImageData(snap.imageData, 0, 0);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(temp, 0, 0, snap.width, snap.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ensureBackgroundWhite(ctx, cssWidth, cssHeight);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));

      const dpr = window.devicePixelRatio || 1;
      const nextW = Math.floor(cssWidth * dpr);
      const nextH = Math.floor(cssHeight * dpr);

      const needsResize = canvas.width !== nextW || canvas.height !== nextH;
      if (needsResize) {
        snapshotRef.current = snapshot();
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = nextW;
        canvas.height = nextH;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          restoreSnapshot(snapshotRef.current, dpr, cssWidth, cssHeight);
          snapshotRef.current = null;
        }
      } else {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ensureBackgroundWhite(ctx, cssWidth, cssHeight);
        }
      }
    };

    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);

    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [brushColor, brushSize, isEraser]);

  // Mobile behavior: default to collapsed toolbar on small screens, open on larger screens.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setToolbarOpen(!mq.matches);
    apply();

    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  /**
   * Initialize history with a "blank canvas" snapshot once the canvas is ready.
   * We commit after the first layout paint so canvas sizing effect has run.
   */
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      if (historyRef.current.length > 0) return;
      commitHistorySnapshot();
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PUBLIC_INTERFACE
  const handleClear = () => {
    /** This is a public function. */
    if (isDrawingRef.current) return; // don't clear mid-stroke
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.floor(rect.width);
    const cssHeight = Math.floor(rect.height);

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    commitHistorySnapshot();
    setTransientStatus("Canvas cleared");
  };

  /**
   * Download helper: create an <a download> with a temporary object URL.
   * We revoke the URL after click to avoid leaking memory.
   */
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // PUBLIC_INTERFACE
  const handleExport = () => {
    /** This is a public function. */
    if (isDrawingRef.current) return; // avoid exporting half-committed stroke
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Ensure white background behind pixels for PNG.
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const rect = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ensureBackgroundWhite(ctx, cssWidth, cssHeight);
    }

    const filename = `drawing-${new Date().toISOString().replaceAll(":", "-")}.png`;

    if (canvas.toBlob) {
      setTransientStatus("Preparing PNG…", 1200);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setTransientStatus("Export failed", 1800);
            return;
          }
          downloadBlob(blob, filename);
          setTransientStatus("PNG downloaded");
        },
        "image/png",
        1.0
      );
      return;
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTransientStatus("PNG downloaded");
    } catch {
      setTransientStatus("Export failed", 1800);
    }
  };

  // PUBLIC_INTERFACE
  const handleUndo = () => {
    /** This is a public function. */
    if (historyIndexRef.current <= 0) return;
    const nextIndex = historyIndexRef.current - 1;
    historyIndexRef.current = nextIndex;

    const snap = historyRef.current[nextIndex];
    restoreHistorySnapshot(snap);

    setHistoryIndex(nextIndex);
    setHistorySize(historyRef.current.length);
  };

  // PUBLIC_INTERFACE
  const handleRedo = () => {
    /** This is a public function. */
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    const nextIndex = historyIndexRef.current + 1;
    historyIndexRef.current = nextIndex;

    const snap = historyRef.current[nextIndex];
    restoreHistorySnapshot(snap);

    setHistoryIndex(nextIndex);
    setHistorySize(historyRef.current.length);
  };

  // PUBLIC_INTERFACE
  const toggleEraser = () => {
    /** This is a public function. */
    setIsEraser((v) => !v);
  };

  /**
   * Keyboard shortcuts:
   * - Ctrl/Cmd + Z => undo
   * - Ctrl/Cmd + Shift + Z => redo
   * - Ctrl/Cmd + Y => redo
   *
   * Guardrails:
   * - Ignore when focused on inputs (range/color) to avoid interfering with native behavior.
   */
  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName?.toLowerCase?.();
      if (!tag) return false;
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    };

    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (isEditableTarget(e.target)) return;

      if (key === "z" && !e.shiftKey) {
        if (historyIndexRef.current > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      if ((key === "z" && e.shiftKey) || key === "y") {
        if (historyIndexRef.current < historyRef.current.length - 1) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Pointer handlers:
   * - Capture pointer so drawing continues if pointer leaves the canvas bounds.
   * - Single active pointer id (ignore extra touches).
   * - Commit history on stroke end.
   */
  const handlePointerDown = (e) => {
    if (e.button != null && e.button !== 0) return; // only primary button for mouse
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return;

    const point = getCanvasPointFromEvent(e);
    if (!point) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    activePointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    lastPointRef.current = point;

    drawDot(point);
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    if (activePointerIdRef.current !== e.pointerId) return;

    const point = getCanvasPointFromEvent(e);
    const last = lastPointRef.current;
    if (!point || !last) return;

    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx === 0 && dy === 0) return;

    drawSegment(last, point);
    lastPointRef.current = point;
    e.preventDefault();
  };

  const endStroke = (e) => {
    if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return;

    const wasDrawing = isDrawingRef.current;

    isDrawingRef.current = false;
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas && activePointerIdRef.current != null) {
      try {
        canvas.releasePointerCapture(activePointerIdRef.current);
      } catch {
        // ignore
      }
    }
    activePointerIdRef.current = null;

    if (wasDrawing) {
      commitHistorySnapshot();
    }

    e.preventDefault();
  };

  return (
    <div className="dsApp">
      <header className="dsTopbar">
        <div className="dsBrand">
          <div className="dsBrandMark" aria-hidden="true" />
          <div className="dsBrandText">
            <div className="dsTitle">Responsive Drawing Studio</div>
            <div className="dsSubtitle">Lightweight canvas sketching</div>
          </div>
        </div>

        <button
          className="dsToolbarToggle"
          type="button"
          onClick={() => setToolbarOpen((v) => !v)}
          aria-expanded={toolbarOpen}
          aria-controls="drawing-toolbar"
        >
          <span className="dsToolbarToggleIcon" aria-hidden="true">
            ☰
          </span>
          Tools
        </button>
      </header>

      <div className="dsMain">
        <aside id="drawing-toolbar" className={`dsToolbar ${toolbarOpen ? "isOpen" : "isClosed"}`}>
          <div className="dsToolbarSection">
            <div className="dsSectionTitle">Brush</div>

            <label className="dsField">
              <span className="dsLabel">Size</span>
              <div className="dsInline">
                <input
                  className="dsRange"
                  type="range"
                  min={1}
                  max={60}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  aria-label="Brush size"
                />
                <span className="dsPill" aria-label={`Brush size ${brushSize}px`}>
                  {brushSize}px
                </span>
              </div>
            </label>

            <label className="dsField">
              <span className="dsLabel">Color</span>
              <div className="dsInline">
                <input
                  className="dsColor"
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                  disabled={isEraser}
                  aria-label="Brush color"
                />
                <span className="dsSwatch" style={{ background: activeColor }} aria-label="Active color swatch" />
                <span className="dsHint">{isEraser ? "Eraser active" : brushColor.toUpperCase()}</span>
              </div>
            </label>

            <div className="dsInline dsInlineWrap">
              <button
                type="button"
                className={`dsBtn ${isEraser ? "dsBtnPrimary" : "dsBtnGhost"}`}
                onClick={toggleEraser}
                aria-pressed={isEraser}
              >
                Eraser
              </button>
              <button type="button" className="dsBtn dsBtnGhost" onClick={() => setIsEraser(false)} disabled={!isEraser}>
                Brush
              </button>
            </div>
          </div>

          <div className="dsToolbarDivider" />

          <div className="dsToolbarSection">
            <div className="dsSectionTitle">History</div>

            <div className="dsInline dsInlineWrap">
              <button type="button" className="dsBtn dsBtnGhost" onClick={handleUndo} disabled={!canUndo || isBusy}>
                Undo
              </button>
              <button type="button" className="dsBtn dsBtnGhost" onClick={handleRedo} disabled={!canRedo || isBusy}>
                Redo
              </button>
            </div>

            <div className="dsMeta">
              <span className="dsMetaDot" aria-hidden="true" />
              History: {Math.min(historyIndex + 1, Math.max(historySize, 1))}/{Math.max(historySize, 1)}
              <span className="dsHint" style={{ marginLeft: 8 }}>
                (Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z)
              </span>
            </div>
          </div>

          <div className="dsToolbarDivider" />

          <div className="dsToolbarSection">
            <div className="dsSectionTitle">Canvas</div>

            <div className="dsInline dsInlineWrap">
              <button type="button" className="dsBtn dsBtnDanger" onClick={handleClear} disabled={isBusy}>
                Clear
              </button>
              <button type="button" className="dsBtn dsBtnPrimary" onClick={handleExport} disabled={isBusy}>
                Export PNG
              </button>
            </div>

            <div className="dsMeta">
              <span className="dsMetaDot" aria-hidden="true" />
              {statusText ? (
                <span aria-live="polite">{statusText}</span>
              ) : (
                <>
                  Tip: On mobile, use the <strong>Tools</strong> button to show/hide the toolbar.
                </>
              )}
            </div>
          </div>
        </aside>

        <main className="dsCanvasPane" aria-label="Drawing canvas area">
          <div className="dsCanvasFrame">
            <div className="dsCanvasHeader">
              <div className="dsCanvasHeaderLeft">
                <span className="dsBadge">Canvas</span>
                <span className="dsCanvasSpec">
                  {isEraser ? "Eraser" : "Brush"} · {brushSize}px · {isEraser ? "(erase)" : brushColor.toUpperCase()}
                </span>
              </div>

              <div className="dsCanvasHeaderRight">
                <button type="button" className="dsBtn dsBtnSmall dsBtnGhost" onClick={handleUndo} disabled={!canUndo || isBusy}>
                  Undo
                </button>
                <button type="button" className="dsBtn dsBtnSmall dsBtnGhost" onClick={handleRedo} disabled={!canRedo || isBusy}>
                  Redo
                </button>
                <button type="button" className="dsBtn dsBtnSmall dsBtnGhost" onClick={handleClear} disabled={isBusy}>
                  Clear
                </button>
                <button type="button" className="dsBtn dsBtnSmall dsBtnPrimary" onClick={handleExport} disabled={isBusy}>
                  Export
                </button>
              </div>
            </div>

            <div className="dsCanvasContainer" ref={containerRef}>
              <canvas
                ref={canvasRef}
                className="dsCanvas"
                aria-label="Drawing canvas"
                role="img"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={endStroke}
              />
            </div>
          </div>
        </main>
      </div>

      <footer className="dsFooter">
        <span className="dsFooterDot" aria-hidden="true" />
        Built with React · Modern light theme · Responsive toolbar
      </footer>
    </div>
  );
}

export default App;
