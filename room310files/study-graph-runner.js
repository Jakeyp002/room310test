// This document runs in a sandboxed iframe with an opaque origin. It receives
// only graph data, never a Room310 session or access to the parent DOM.
const stage = document.querySelector("#graph");
const status = document.querySelector("#status");
let initialized = false;

function showError() {
  status.textContent = "The interactive graph could not load. Check your connection and try graphing again.";
  status.hidden = false;
}

window.addEventListener("message", (event) => {
  if (initialized || event.source !== window.parent || event.data?.type !== "room310-graph") return;
  const { apiKey, expressions, bounds } = event.data;
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(apiKey || "") || !Array.isArray(expressions)
    || expressions.length < 1 || expressions.length > 32
    || expressions.some((expression) => typeof expression?.latex !== "string" || !expression.latex.trim() || expression.latex.length > 500
      || (expression.color !== undefined && !/^#[0-9a-f]{6}$/i.test(expression.color))
      || (expression.hidden !== undefined && typeof expression.hidden !== "boolean"))
    || !bounds || !["left", "right", "bottom", "top"].every((key) => Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 1_000_000)
    || bounds.right <= bounds.left || bounds.top <= bounds.bottom) {
    showError();
    return;
  }
  initialized = true;
  const script = document.createElement("script");
  script.src = `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
  const timeout = window.setTimeout(showError, 15_000);
  script.onerror = () => {
    window.clearTimeout(timeout);
    showError();
  };
  script.onload = () => {
    window.clearTimeout(timeout);
    try {
      if (!window.Desmos?.GraphingCalculator) throw new Error("Desmos is unavailable");
      const calculator = Desmos.GraphingCalculator(stage, {
        expressions: true,
        settingsMenu: true,
        zoomButtons: true,
        images: false,
        links: false,
        pasteGraphLink: true,
        autosize: true
      });
      const colors = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#000000", "#8c564b", "#d6278b"];
      calculator.setExpressions(expressions.map(({ latex, color, hidden }, index) => ({
        id: `room310_${index + 1}`,
        latex,
        color: color || colors[index % colors.length],
        hidden: hidden === true
      })));
      calculator.setMathBounds(bounds);
      status.hidden = true;
    } catch {
      showError();
    }
  };
  document.head.append(script);
});
