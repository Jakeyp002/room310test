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
    || expressions.length < 1 || expressions.length > 8
    || expressions.some((expression) => typeof expression?.latex !== "string" || expression.latex.length > 240)
    || !bounds || !["left", "right", "bottom", "top"].every((key) => Number.isFinite(bounds[key]))) {
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
        autosize: true
      });
      const colors = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19", "#000000", "#8c564b", "#d6278b"];
      calculator.setExpressions(expressions.map(({ latex }, index) => ({ id: `room310_${index + 1}`, latex, color: colors[index] })));
      calculator.setMathBounds(bounds);
      status.hidden = true;
    } catch {
      showError();
    }
  };
  document.head.append(script);
});
