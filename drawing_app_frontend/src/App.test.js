import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

function stubCanvas() {
  // JSDOM doesn't implement canvas; stub the minimum used by App.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      // snapshot/restore + white background helpers
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: () => undefined,
      setTransform: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      drawImage: () => undefined,

      // drawing ops
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      arc: () => undefined,
      fill: () => undefined,

      // style props
      globalCompositeOperation: "source-over",
      strokeStyle: "#000",
      fillStyle: "#fff",
      lineCap: "round",
      lineJoin: "round",
      lineWidth: 1,
    }),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: (cb) => cb(new Blob(["png"], { type: "image/png" })),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => "data:image/png;base64,AAAA",
  });

  // Provide predictable measurements for layout-dependent code.
  Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 500,
      height: 400,
      top: 0,
      left: 0,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  // Container sizing is based on its own bounding rect.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function getBoundingClientRect() {
      // default; tests can override if needed
      return {
        width: 500,
        height: 400,
        top: 0,
        left: 0,
        right: 500,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  });

  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // matchMedia is used for responsive toolbar default.
  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));

  // In tests we want a stable timestamp for export filename.
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
}

describe("Responsive Drawing Studio core UI", () => {
  beforeEach(() => {
    stubCanvas();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("renders primary UI landmarks and accessible controls", async () => {
    render(<App />);

    expect(screen.getByText(/Responsive Drawing Studio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tools/i })).toBeInTheDocument();

    // Canvas is discoverable by aria-label.
    expect(screen.getByLabelText(/drawing canvas/i)).toBeInTheDocument();

    // Toolbar controls are accessible via labels.
    expect(screen.getByLabelText(/brush size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brush color/i)).toBeInTheDocument();

    // Custom palette actions exist.
    expect(screen.getByRole("button", { name: /save current brush color to favorites/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear favorite colors/i })).toBeInTheDocument();

    // Ensure status region exists (even if empty initially).
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  test("undo/redo are disabled initially, then enable after a stroke; redo enables after undo", async () => {
    render(<App />);

    const undoButtons = screen.getAllByRole("button", { name: /^undo/i });
    const redoButtons = screen.getAllByRole("button", { name: /^redo/i });

    // Initially, history has only the blank snapshot => cannot undo/redo.
    undoButtons.forEach((btn) => expect(btn).toBeDisabled());
    redoButtons.forEach((btn) => expect(btn).toBeDisabled());

    const canvas = screen.getByLabelText(/drawing canvas/i);

    // Draw a stroke (down + up triggers commitHistorySnapshot).
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 20, clientY: 20 });

    // After a stroke, undo should enable and redo remain disabled.
    await waitFor(() => undoButtons.forEach((btn) => expect(btn).not.toBeDisabled()));
    redoButtons.forEach((btn) => expect(btn).toBeDisabled());

    // Click one of the undo buttons; redo should enable.
    await userEvent.click(undoButtons[0]);
    await waitFor(() => redoButtons.forEach((btn) => expect(btn).not.toBeDisabled()));
  });

  test("export wiring creates a downloadable link and announces status", async () => {
    const createElementSpy = jest.spyOn(document, "createElement");
    const appendSpy = jest.spyOn(document.body, "appendChild");
    const removeSpy = jest.spyOn(document.body, "removeChild");

    // Intercept the anchor that downloadBlob creates.
    let lastAnchor = null;
    createElementSpy.mockImplementation((tagName) => {
      if (tagName === "a") {
        const a = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
        a.click = jest.fn();
        lastAnchor = a;
        return a;
      }
      return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
    });

    render(<App />);

    // Use the toolbar button (unambiguous label).
    await userEvent.click(screen.getByRole("button", { name: /export png/i }));

    await waitFor(() => {
      expect(lastAnchor).not.toBeNull();
      expect(lastAnchor.download).toMatch(/^drawing-2025-01-01T00-00-00\.000Z\.png$/);
      // href should be a blob URL (from URL.createObjectURL)
      expect(String(lastAnchor.href)).toMatch(/^blob:/);
      expect(lastAnchor.click).toHaveBeenCalledTimes(1);
    });

    // Cleanup called (anchor add/remove).
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();

    // Status is set (either "Preparing PNG…" or "PNG downloaded").
    const statuses = screen.getAllByRole("status");
    expect(statuses.map((n) => n.textContent).join(" ")).toMatch(/Preparing PNG|PNG downloaded/);
  });

  test("custom palette: save favorite, persists to localStorage, and can remove", async () => {
    const user = userEvent.setup();

    // Start from a known storage state.
    window.localStorage.clear();

    render(<App />);

    const saveBtn = screen.getByRole("button", { name: /save current brush color to favorites/i });

    // Initial brush color is #3b82f6 (from App state). Save it.
    await user.click(saveBtn);

    // It should now appear in favorites as a button with the correct aria-label.
    expect(screen.getByRole("button", { name: /set brush color to favorite #3b82f6/i })).toBeInTheDocument();

    // localStorage should contain our palette key.
    const raw = window.localStorage.getItem("drawingStudio.customPalette.v1");
    expect(raw).toBeTruthy();
    expect(String(raw)).toMatch(/#3b82f6/i);

    // Remove it.
    await user.click(screen.getByRole("button", { name: /remove #3b82f6 from favorites/i }));

    // Favorite should no longer be present.
    expect(screen.queryByRole("button", { name: /set brush color to favorite #3b82f6/i })).toBeNull();
  });

  test("keyboard shortcut: Ctrl/Cmd+S saves current brush color to favorites", async () => {
    render(<App />);

    // Start from a known storage state.
    window.localStorage.clear();

    // Trigger the shortcut. (Ctrl+S on Windows/Linux; Cmd+S on macOS)
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    // Favorites should now include the default brush color (#3b82f6).
    expect(await screen.findByRole("button", { name: /set brush color to favorite #3b82f6/i })).toBeInTheDocument();

    const raw = window.localStorage.getItem("drawingStudio.customPalette.v1");
    expect(raw).toBeTruthy();
    expect(String(raw)).toMatch(/#3b82f6/i);
  });

  test("keyboard shortcut: E toggles eraser and updates the canvas header mode text", async () => {
    render(<App />);

    // Initially brush mode is shown.
    expect(screen.getByText(/Brush · 12px/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e" });

    // Now eraser mode is shown.
    expect(await screen.findByText(/Eraser · 12px/i)).toBeInTheDocument();

    // Toggle back.
    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByText(/Brush · 12px/i)).toBeInTheDocument();
  });

  test("keyboard shortcut: Delete clears the canvas and announces status", async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: "Delete" });

    const statuses = screen.getAllByRole("status");
    expect(statuses.map((n) => n.textContent).join(" ")).toMatch(/Canvas cleared/i);
  });

  test("keyboard shortcut: Ctrl/Cmd+P exports PNG (intercepts print) and creates a download link", async () => {
    const createElementSpy = jest.spyOn(document, "createElement");
    let lastAnchor = null;

    createElementSpy.mockImplementation((tagName) => {
      if (tagName === "a") {
        const a = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
        a.click = jest.fn();
        lastAnchor = a;
        return a;
      }
      return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
    });

    render(<App />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });

    await waitFor(() => {
      expect(lastAnchor).not.toBeNull();
      expect(lastAnchor.download).toMatch(/^drawing-2025-01-01T00-00-00\.000Z\.png$/);
      expect(String(lastAnchor.href)).toMatch(/^blob:/);
    });
  });

  test("keyboard shortcuts: [ and ] adjust brush size; 0 resets to 12", async () => {
    render(<App />);

    // Default is 12px.
    expect(screen.getByLabelText(/Brush size 12px/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "]" });
    expect(await screen.findByLabelText(/Brush size 13px/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "[" });
    expect(await screen.findByLabelText(/Brush size 12px/i)).toBeInTheDocument();

    // 0 reset
    fireEvent.keyDown(window, { key: "]" });
    fireEvent.keyDown(window, { key: "]" });
    expect(await screen.findByLabelText(/Brush size 14px/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "0" });
    expect(await screen.findByLabelText(/Brush size 12px/i)).toBeInTheDocument();
  });
});
