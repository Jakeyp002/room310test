(() => {
  "use strict";
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    document.querySelectorAll("[data-colab-link]").forEach(link => {
      link.href = "https://colab.research.google.com/";
      link.textContent = "Open Colab · upload notebook ↗";
    });
    document.querySelectorAll(".dl-preview-note").forEach(note => { note.hidden = false; });
  }
  // Code remains selectable and downloads still work without clipboard access.
  document.querySelectorAll(".dl-copy").forEach(button => {
    button.hidden = false;
    button.addEventListener("click", async () => {
      const source = button.closest(".dl-code").querySelector("pre code").textContent;
      try {
        await navigator.clipboard.writeText(source);
        button.textContent = "Copied!";
      } catch {
        const pre = button.closest(".dl-code").querySelector("pre");
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        pre.focus();
        button.textContent = "Selected — press Ctrl/⌘ + C";
      }
      setTimeout(() => { button.textContent = "Copy code"; }, 3500);
    });
  });
})();
