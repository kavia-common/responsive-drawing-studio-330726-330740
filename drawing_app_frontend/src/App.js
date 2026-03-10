import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * Responsive Drawing Studio
 *
 * Step 01.02 scope:
 * - Actual freehand drawing on canvas using Pointer Events
 * - Brush size, color, and eraser mode
 * - Correct coordinate mapping on resize + device pixel ratio handling
 * - Toolbar controls wired to affect drawing behavior
 *
 * Note: Real undo/redo history is implemented in later steps.
 */

// PUBLIC_INTERFACE
function App() {
  /** UI state */
  const [brushSize, setBrushSize] = useState(12);
  const [brushColor, setBrushColor] = useState("#3b82f6");
  const [isEraser, setIsEraser] = useState(false);

  /** History counters as placeholders until real history is implemented */
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historySize, setHistorySize] = useState(0);

  /** Responsive toolbar */
  const [toolbarOpen, setToolbarOpen] = useState(true);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  /** Drawing state kept in refs to avoid re-rendering on every pointer move. */
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const activePointerIdRef = useRef(null);

  /** Used for resizing while preserving existing pixels. */
  const snapshotRef = useRef(null);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historySize;

  const activeColor = useMemo(() => (isEraser ? "#ffffff" : brushColor), [isEraser, brushColor]);

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
   * For erasing we use `destination-out` so it truly erases (reveals white bg).
   */
  const applyStrokeStyle = (ctx) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;

    if (isEraser) {
      // Erase by clearing pixels rather than painting white; background remains white.
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
    // For eraser, composite operation is destination-out so fill clears pixels.
    ctx.fill();
    ctx.restore();
  };

  // Keep a crisp canvas in the available container space (DPR aware) and preserve content on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ensureBackgroundWhite = (ctx, cssWidth, cssHeight) => {
      // Fill behind existing pixels: destination-over only affects transparent pixels.
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.restore();
    };

    const snapshot = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { imageData, width: canvas.width, height: canvas.height };
      } catch {
        // Some environments may throw (e.g., tainted canvas). Not expected here.
        return null;
      }
    };

    const restoreSnapshot = (snap, dpr, cssWidth, cssHeight) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !snap) return;

      // Draw old bitmap scaled into the new canvas (in device pixels).
      const temp = document.createElement("canvas");
      temp.width = snap.width;
      temp.height = snap.height;
      const tctx = temp.getContext("2d");
      if (!tctx) return;
      tctx.putImageData(snap.imageData, 0, 0);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // work in device pixels for drawImage
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(temp, 0, 0, snap.width, snap.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Re-apply CSS coordinate transform and ensure white background.
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

      // Snapshot before resizing (resizing clears the canvas).
      const needsResize = canvas.width !== nextW || canvas.height !== nextH;
      if (needsResize) {
        snapshotRef.current = snapshot();
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = nextW;
        canvas.height = nextH;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Map drawing coordinates to CSS pixels.
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          restoreSnapshot(snapshotRef.current, dpr, cssWidth, cssHeight);
          snapshotRef.current = null;
        }
      } else {
        // Keep CSS size synced even if device pixels unchanged.
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

    // Support both modern + older browsers.
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  // PUBLIC_INTERFACE
  const handleClear = () => {
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

    // Fill white so export looks clean.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Placeholder: reset history until real implementation.
    setHistoryIndex(0);
    setHistorySize(0);
  };

  // PUBLIC_INTERFACE
  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Export as PNG. Background is filled white.
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `drawing-${new Date().toISOString().replaceAll(":", "-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // PUBLIC_INTERFACE
  const handleUndo = () => {
    // Placeholder until real drawing history exists.
    setHistoryIndex((v) => Math.max(0, v - 1));
  };

  // PUBLIC_INTERFACE
  const handleRedo = () => {
    // Placeholder until real drawing history exists.
    setHistoryIndex((v) => Math.min(historySize, v + 1));
  };

  // PUBLIC_INTERFACE
  const toggleEraser = () => {
    setIsEraser((v) => !v);
  };

  /**
   * Pointer handlers:
   * - Capture pointer so drawing continues if pointer leaves the canvas bounds.
   * - Single active pointer id (ignore extra touches).
   */
  const handlePointerDown = (e) => {
    if (e.button != null && e.button !== 0) return; // only primary button for mouse
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only allow one active pointer (prevents multi-touch scribbles for now).
    if (activePointerIdRef.current != null && activePointerIdRef.current !== e.pointerId) return;

    const point = getCanvasPointFromEvent(e);
    if (!point) return;

    // Capture so we keep receiving moves even outside the element.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    activePointerIdRef.current = e.pointerId;
    isDrawingRef.current = true;
    lastPointRef.current = point;

    // A down event should produce a mark even without movement.
    drawDot(point);
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    if (activePointerIdRef.current !== e.pointerId) return;

    const point = getCanvasPointFromEvent(e);
    const last = lastPointRef.current;
    if (!point || !last) return;

    // Avoid extremely tiny segments.
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx === 0 && dy === 0) return;

    drawSegment(last, point);
    lastPointRef.current = point;
    e.preventDefault();
  };

  const endStroke = (e) => {
    if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return;

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
              <button type="button" className="dsBtn dsBtnGhost" onClick={handleUndo} disabled={!canUndo}>
                Undo
              </button>
              <button type="button" className="dsBtn dsBtnGhost" onClick={handleRedo} disabled={!canRedo}>
                Redo
              </button>
            </div>

            <div className="dsMeta">
              <span className="dsMetaDot" aria-hidden="true" />
              History (placeholder): {historyIndex}/{historySize}
            </div>
          </div>

          <div className="dsToolbarDivider" />

          <div className="dsToolbarSection">
            <div className="dsSectionTitle">Canvas</div>

            <div className="dsInline dsInlineWrap">
              <button type="button" className="dsBtn dsBtnDanger" onClick={handleClear}>
                Clear
              </button>
              <button type="button" className="dsBtn dsBtnPrimary" onClick={handleExport}>
                Export PNG
              </button>
            </div>

            <div className="dsMeta">
              Tip: On mobile, use the <strong>Tools</strong> button to show/hide the toolbar.
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
                <button type="button" className="dsBtn dsBtnSmall dsBtnGhost" onClick={handleClear}>
                  Clear
                </button>
                <button type="button" className="dsBtn dsBtnSmall dsBtnPrimary" onClick={handleExport}>
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
