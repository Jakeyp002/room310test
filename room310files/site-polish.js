(() => {
  "use strict";

  const logo = document.querySelector(".header .logo");
  if (logo && !document.querySelector(".site-version-badge")) {
    const version = document.createElement("span");
    version.className = "site-version-badge";
    version.textContent = "v0.5";
    version.setAttribute("aria-label", "Room310 version 0.5");
    logo.after(version);
  }

  const needsCourseLab = document.body.matches(".java-page, .cpp-page, .sql-page, .javascript-page, .csharp-page");
  const needsAssignmentWorkspace = document.body.classList.contains("curriculum-page");
  const loadCourseLab = () => {
    if (!needsCourseLab || document.documentElement.dataset.courseRunner || document.querySelector('script[src^="course-lab.js"]')) return;
    const script = document.createElement("script");
    script.src = "course-lab.js?v=1.2";
    document.body.append(script);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadCourseLab, { once: true });
  else loadCourseLab();

  const loadAssignmentWorkspace = () => {
    if (!needsAssignmentWorkspace || document.documentElement.dataset.assignmentWorkspace || document.querySelector('script[src^="assignment-workspace.js"]')) return;
    const script = document.createElement("script");
    script.src = "assignment-workspace.js?v=0.2";
    document.body.append(script);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadAssignmentWorkspace, { once: true });
  else loadAssignmentWorkspace();

  const article = document.querySelector(".lesson-content");

  document.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  if (!article) return;

  const cleanText = (value) => value.replace(/[\uEC02\uEC03]/g, "").replace(/\s+/g, " ").trim();

  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    node.nodeValue = node.nodeValue.replace(/[\uEC02\uEC03]/g, "");
  });

  article.querySelectorAll("h1, h2, h3, h4, h5, h6, p").forEach((element) => {
    const hasMeaningfulMedia = element.querySelector("img, video, audio, iframe, pre, code");
    if (!cleanText(element.textContent) && !hasMeaningfulMedia) element.remove();
  });

  if (document.body.classList.contains("authored-course-page")) return;
  document.body.classList.add("legacy-course-page");

  const editorialOnly = [
    /^need to put\b/i,
    /^remove slicing\b/i,
    /^is there inheritance\b/i,
    /^expand on assignments\b/i,
    /^come up with bigger\b/i,
    /^quizzes for all\b/i,
    /^gui$/i,
    /^finkel feedback\b/i,
    /^to be reviewed:?$/i,
    /^\(might need to make\b/i,
    /^\(p\d+\s+bottom\b/i,
    /^\(maybe go back\b/i
  ];

  article.querySelectorAll("p, li").forEach((element) => {
    const value = cleanText(element.textContent);
    if (!editorialOnly.some((pattern) => pattern.test(value))) return;
    const panel = element.closest(".code-panel");
    if (panel && panel.querySelectorAll("p, li").length === 1) panel.remove();
    else element.remove();
  });

  const children = [...article.children];
  const firstHeadingIndex = children.findIndex(
    (element) => /^H[1-3]$/.test(element.tagName) && cleanText(element.textContent)
  );
  const preface = firstHeadingIndex < 0 ? [] : children.slice(0, firstHeadingIndex);
  const tocRows = preface.filter((element) => {
    if (element.tagName !== "P" || element.children.length !== 1) return false;
    const link = element.firstElementChild;
    return link?.tagName === "A" && link.getAttribute("href")?.startsWith("#");
  });

  if (tocRows.length >= 3) {
    const details = document.createElement("details");
    details.className = "lesson-toc";
    const summary = document.createElement("summary");
    summary.innerHTML = `<span>On this page</span><small>${tocRows.length} sections</small>`;
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Lesson table of contents");
    tocRows.forEach((row) => nav.append(row.firstElementChild));
    details.append(summary, nav);
    tocRows[0].before(details);
    tocRows.forEach((row) => row.remove());
  }

  const heroTitle = cleanText(document.querySelector(".lesson-hero h1")?.textContent || "").toLowerCase();
  const firstContent = article.firstElementChild;
  if (firstContent && heroTitle) {
    const firstText = cleanText(firstContent.textContent).toLowerCase();
    const hasCode = firstContent.querySelector("pre, code") || /\b(print|def|class|return|import)\b/.test(firstText);
    if (!hasCode && firstText.endsWith(heroTitle) && firstText.length < heroTitle.length + 40) firstContent.remove();
  }

  let previous = null;
  [...article.children].forEach((element) => {
    const value = cleanText(element.textContent);
    if (previous && value.length > 30 && value === cleanText(previous.textContent) && element.tagName === previous.tagName) {
      element.remove();
      return;
    }
    if (value) previous = element;
  });
})();
