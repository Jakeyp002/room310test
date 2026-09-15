import { decorateMarkdown, markdown } from "./ai-renderer.js";
import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";

const workspace = window.Room310AssignmentWorkspace;
if (!workspace?.hasAssignment || document.documentElement.dataset.assignmentHelp) {
  // Assignment Help is deliberately absent from lesson pages without a coding task.
} else {
  const siteVersion = window.ROOM310_VERSION || "0.0.0";
  document.documentElement.dataset.assignmentHelp = `v${siteVersion}`;

  const state = {
    session: null,
    messages: [],
    pending: false,
    request: null,
    remaining: null,
    lastOpener: null,
    contextId: null
  };

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "assignment-help-launch";
  launcher.setAttribute("aria-controls", "assignment-help-panel");
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = '<span aria-hidden="true">?</span><span>Assignment help</span>';

  const panel = document.createElement("aside");
  panel.id = "assignment-help-panel";
  panel.className = "assignment-help-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Assignment Help");
  panel.innerHTML = `
    <header class="assignment-help-header">
      <div><span class="assignment-help-kicker">Room 310 · Hints first</span><strong>Assignment Help</strong></div>
      <div class="assignment-help-header-actions"><span class="assignment-help-version">v${siteVersion}</span><button type="button" class="assignment-help-close" aria-label="Close Assignment Help">×</button></div>
    </header>
    <section class="assignment-help-context" aria-label="Current assignment">
      <div><span>Current assignment</span><strong class="assignment-help-context-title">Coding assignment</strong><small class="assignment-help-context-meta"></small></div>
      <button type="button" class="assignment-help-switch">Open workspace <span aria-hidden="true">→</span></button>
    </section>
    <section class="assignment-help-auth" aria-labelledby="assignment-help-auth-title">
      <div><small>Room310 members</small><h2 id="assignment-help-auth-title">Sign in for help.</h2><p>Your account is verified before any assignment context is sent to the tutor.</p></div>
      <form class="assignment-help-login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button type="submit">Sign in <span aria-hidden="true">→</span></button>
        <p class="assignment-help-form-message" role="status"></p>
      </form>
    </section>
    <section class="assignment-help-chat" aria-label="Assignment Help chat" hidden>
      <div class="assignment-help-chatbar"><span class="assignment-help-account"></span><button type="button" class="assignment-help-new-chat">New chat</button><button type="button" class="assignment-help-sign-out">Sign out</button></div>
      <div class="assignment-help-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="assignment-help-suggestions" aria-label="Suggested questions">
        <button type="button" data-prompt="Give me one hint for how to start.">Give me a starting hint</button>
        <button type="button" data-prompt="Explain what this assignment is asking me to do in smaller steps.">Break down the task</button>
        <button type="button" data-prompt="Help me debug my current code without writing the whole solution for me.">Debug my code</button>
      </div>
      <form class="assignment-help-form">
        <label class="sr-only" for="assignment-help-input">Ask for help with the current assignment</label>
        <textarea id="assignment-help-input" rows="1" maxlength="4000" placeholder="Where are you stuck?" enterkeyhint="send" required></textarea>
        <div><span class="assignment-help-status" role="status">Enter to send · Shift+Enter for a new line</span><button type="submit" class="assignment-help-send">Send <span aria-hidden="true">↑</span></button></div>
      </form>
      <p class="assignment-help-privacy">Session only · Assignment text and your current workspace code are sent with each question. Chats are not saved by Room310.</p>
    </section>`;

  const closeButton = panel.querySelector(".assignment-help-close");
  const contextTitle = panel.querySelector(".assignment-help-context-title");
  const contextMeta = panel.querySelector(".assignment-help-context-meta");
  const switchButton = panel.querySelector(".assignment-help-switch");
  const authPanel = panel.querySelector(".assignment-help-auth");
  const loginForm = panel.querySelector(".assignment-help-login-form");
  const loginMessage = panel.querySelector(".assignment-help-form-message");
  const chatPanel = panel.querySelector(".assignment-help-chat");
  const account = panel.querySelector(".assignment-help-account");
  const messagesElement = panel.querySelector(".assignment-help-messages");
  const suggestions = panel.querySelector(".assignment-help-suggestions");
  const form = panel.querySelector(".assignment-help-form");
  const input = panel.querySelector(".assignment-help-form textarea");
  const sendButton = panel.querySelector(".assignment-help-send");
  const status = panel.querySelector(".assignment-help-status");

  function currentContext() {
    const context = workspace.getContext();
    if (!context) throw new Error("Room310 could not find a coding assignment on this page.");
    return context;
  }

  function updateContextLabel() {
    const context = currentContext();
    contextTitle.textContent = context.assignmentTitle;
    contextMeta.textContent = `${context.languageLabel} · Assignment ${context.metadata.assignmentNumber} of ${context.metadata.assignmentCount}`;
    return context;
  }

  function createMessage(role, content = "", pending = false) {
    const article = document.createElement("article");
    article.className = `assignment-help-message assignment-help-message-${role}`;
    const label = document.createElement("span");
    label.className = "assignment-help-message-label";
    label.textContent = role === "user" ? "You" : "Room 310 Assignment Help";
    const body = document.createElement("div");
    body.className = "assignment-help-message-body";
    article.append(label, body);
    messagesElement.append(article);
    const update = (value) => {
      body.innerHTML = markdown(value);
      decorateMarkdown(body);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    };
    if (pending) body.innerHTML = '<span class="study-ai-typing" aria-label="Assignment Help is thinking"><i></i><i></i><i></i></span>';
    else update(content);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return { article, label, body, update };
  }

  function welcome() {
    return "I can see the **current assignment**, lesson context, and your latest workspace code. Tell me where you’re stuck—I’ll start with a useful hint and help you reason forward.";
  }

  function resetChat({ focus = false } = {}) {
    state.request?.abort();
    state.messages = [];
    state.remaining = null;
    state.contextId = currentContext().assignmentId;
    messagesElement.replaceChildren();
    createMessage("assistant", welcome());
    status.textContent = "Enter to send · Shift+Enter for a new line";
    input.value = "";
    resizeInput();
    if (focus) input.focus();
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }

  function setPending(pending) {
    state.pending = pending;
    messagesElement.setAttribute("aria-busy", String(pending));
    input.disabled = pending;
    sendButton.disabled = pending;
    suggestions.querySelectorAll("button").forEach((button) => { button.disabled = pending; });
    panel.querySelector(".assignment-help-new-chat").disabled = pending;
    switchButton.disabled = pending;
  }

  function applySession(session) {
    const valid = session?.access_token && session.user && !session.user.is_anonymous ? session : null;
    const userChanged = state.session?.user?.id && state.session.user.id !== valid?.user?.id;
    state.session = valid;
    authPanel.hidden = Boolean(valid);
    chatPanel.hidden = !valid;
    account.textContent = valid ? (valid.user.email || "Room310 account") : "";
    if (valid && (userChanged || !messagesElement.childElementCount)) resetChat();
  }

  async function readError(response) {
    try {
      return await response.json();
    } catch {
      return { error: "Assignment Help returned an unreadable response. Please try again." };
    }
  }

  async function streamResponse(response, assistantMessage) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Assignment Help returned an empty response. Please try again.");
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const handleLine = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { throw new Error("Assignment Help returned an unreadable response. Please try again."); }
      if (event.type === "meta" && Number.isInteger(event.remaining)) state.remaining = event.remaining;
      if (event.type === "delta" && typeof event.text === "string") {
        answer += event.text;
        assistantMessage.update(answer);
        status.textContent = "Assignment Help is writing…";
      }
      if (event.type === "error") throw new Error(event.error || "Assignment Help could not finish that response.");
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(handleLine);
      if (done) break;
    }
    handleLine(buffer);
    if (!answer.trim()) throw new Error("Assignment Help did not return an answer. Please try again.");
    return answer;
  }

  function showConfirmation(data, question, context) {
    const article = document.createElement("article");
    article.className = "assignment-help-confirmation";
    article.innerHTML = `<span>Solution check</span><strong>This will reveal part or all of the assignment solution.</strong><p></p><div><button type="button" data-choice="hint">Give me another hint</button><button type="button" data-choice="answer">Show me the answer</button></div>`;
    article.querySelector("p").textContent = data.message || "Would you like another hint, or do you want to reveal the complete answer for this assignment?";
    article.querySelectorAll("button").forEach((button) => button.addEventListener("click", async () => {
      article.querySelectorAll("button").forEach((item) => { item.disabled = true; });
      await requestAnswer(question, context, { token: data.confirmationToken, decision: button.dataset.choice }, article);
    }));
    messagesElement.append(article);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  async function requestAnswer(question, context, solutionConfirmation = null, confirmationCard = null) {
    setPending(true);
    status.textContent = "Assignment Help is thinking…";
    const assistantMessage = createMessage("assistant", "", true);
    const controller = new AbortController();
    state.request = controller;
    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { authorization: `Bearer ${state.session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({
          mode: "assignment_help",
          subject: "Computer Science",
          messages: state.messages.slice(-20),
          assignmentContext: context,
          ...(solutionConfirmation ? { solutionConfirmation } : {})
        }),
        signal: controller.signal
      });
      if (response.status === 409) {
        const data = await readError(response);
        assistantMessage.article.remove();
        confirmationCard?.remove();
        showConfirmation(data, question, context);
        status.textContent = "Choose whether to continue with a hint or reveal the solution.";
        return;
      }
      if (!response.ok) {
        const data = await readError(response);
        const error = new Error(data.error || "Assignment Help could not complete that request.");
        error.status = response.status;
        throw error;
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("Assignment Help returned an unreadable response. Please try again.");
      confirmationCard?.remove();
      const answer = await streamResponse(response, assistantMessage);
      state.messages.push({ role: "assistant", content: answer });
      status.textContent = Number.isInteger(state.remaining)
        ? `${state.remaining} questions remaining this hour · Enter to send`
        : "Enter to send · Shift+Enter for a new line";
    } catch (error) {
      assistantMessage.article.dataset.state = "error";
      assistantMessage.label.textContent = "Assignment Help notice";
      assistantMessage.update(error.name === "AbortError" ? "That response was stopped." : error.message);
      status.textContent = "Your chat is still here. You can try again.";
      if (error.status === 401) await supabase.auth.signOut();
      confirmationCard?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    } finally {
      state.request = null;
      setPending(false);
      if (!panel.hidden) input.focus();
    }
  }

  async function sendQuestion(questionOverride = "") {
    const question = (questionOverride || input.value).trim();
    if (!question || state.pending || !state.session) return;
    const context = updateContextLabel();
    if (state.contextId && state.contextId !== context.assignmentId) resetChat();
    state.contextId = context.assignmentId;
    state.messages.push({ role: "user", content: question });
    createMessage("user", question);
    input.value = "";
    resizeInput();
    await requestAnswer(question, context);
  }

  function open(opener = launcher) {
    workspace.close({ restoreFocus: false });
    state.lastOpener = opener;
    const context = updateContextLabel();
    if (state.session && state.contextId && state.contextId !== context.assignmentId) resetChat();
    panel.hidden = false;
    document.body.classList.add("assignment-help-open");
    launcher.setAttribute("aria-expanded", "true");
    closeButton.focus();
  }

  function close({ restoreFocus = true } = {}) {
    state.request?.abort();
    panel.hidden = true;
    document.body.classList.remove("assignment-help-open");
    launcher.setAttribute("aria-expanded", "false");
    if (restoreFocus) state.lastOpener?.focus?.();
  }

  launcher.addEventListener("click", () => open(launcher));
  closeButton.addEventListener("click", () => close());
  switchButton.addEventListener("click", () => {
    close({ restoreFocus: false });
    workspace.open();
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); sendQuestion(); });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  suggestions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-prompt]");
    if (button) sendQuestion(button.dataset.prompt);
  });
  panel.querySelector(".assignment-help-new-chat").addEventListener("click", () => resetChat({ focus: true }));
  panel.querySelector(".assignment-help-sign-out").addEventListener("click", async () => {
    state.request?.abort();
    await supabase.auth.signOut();
    state.messages = [];
    messagesElement.replaceChildren();
  });
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    const data = new FormData(loginForm);
    button.disabled = true;
    loginMessage.textContent = "Checking your account…";
    loginMessage.dataset.state = "working";
    try {
      const { data: signedIn, error } = await supabase.auth.signInWithPassword({
        email: String(data.get("email") || "").trim(),
        password: String(data.get("password") || "")
      });
      if (error) throw error;
      applySession(signedIn.session);
      loginMessage.textContent = "";
      loginForm.reset();
      input.focus();
    } catch (error) {
      loginMessage.textContent = messageFor(error, "Sign in failed. Check your email and password.");
      loginMessage.dataset.state = "error";
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });
  window.addEventListener("room310:assignment-workspace-opened", () => close({ restoreFocus: false }));

  window.Room310AssignmentHelp = { isOpen: () => !panel.hidden, open, close, reset: resetChat };
  document.body.append(launcher, panel);

  if (!isConfigured) {
    loginMessage.textContent = configurationMessage;
    loginForm.querySelector('button[type="submit"]').disabled = true;
  } else {
    supabase.auth.getSession().then(({ data }) => applySession(data.session)).catch(() => applySession(null));
    supabase.auth.onAuthStateChange((_event, session) => applySession(session));
  }
}
