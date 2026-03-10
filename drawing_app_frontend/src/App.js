import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * Responsive Drawing Studio - Baseline UI
 *
 * Step 01.01 scope:
 * - Replace placeholder App with a responsive layout: toolbar + central canvas
 * - Provide UI controls: brush size, color picker, eraser, undo/redo, clear, export
 * - Implement mobile-collapsible toolbar behavior
 * - Implement export (PNG download) and clear (visual clear) as baseline interactions
 *
 * Note: Full drawing interactions + real undo/redo stacks are implemented in later steps.
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

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historySize;

  const activeColor = useMemo(() => (isEraser ? "#ffffff" : brushColor), [isEraser, brushColor]);

  // Keep a crisp canvas in the available container space.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));

      const dpr = window.devicePixelRatio || 1;

      // Only resize if needed to avoid clearing content too often (later: preserve drawings).
      if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // Baseline: fill with white so export background is not transparent.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cssWidth, cssHeight);
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
  }, []);

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

    const cssWidth = Math.floor(canvas.getBoundingClientRect().width);
    const cssHeight = Math.floor(canvas.getBoundingClientRect().height);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset in case transforms exist later
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

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

    // Export as PNG. Canvas is already filled white in baseline.
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
                  {isEraser ? "Eraser" : "Brush"} · {brushSize}px · {isEraser ? "#FFFFFF" : brushColor.toUpperCase()}
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
              />
              <div className="dsCanvasOverlay" aria-hidden="true">
                <div className="dsOverlayCard">
                  <div className="dsOverlayTitle">Baseline UI ready</div>
                  <div className="dsOverlayText">
                    Drawing interactions will be enabled in the next step. Use toolbar controls to preview UI and export a blank canvas.
                  </div>
                </div>
              </div>
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
