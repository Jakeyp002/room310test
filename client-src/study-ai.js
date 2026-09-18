import { decorateMarkdown, markdown } from "./ai-renderer.js";
import { configurationMessage, isConfigured, messageFor, supabase } from "./supabase-client.js";

const authPanel = document.querySelector("#study-ai-auth");
const chatPanel = document.querySelector("#study-ai-chat");
const loginForm = document.querySelector("#study-ai-login-form");
const loginMessage = document.querySelector("#study-ai-login-message");
const accessLabel = document.querySelector("#study-ai-access-label");
const account = document.querySelector("#study-ai-account");
const userLabel = document.querySelector("#study-ai-user");
const signOutButton = document.querySelector("#study-ai-sign-out");
const subjectSelect = document.querySelector("#study-ai-subject");
const newChatButton = document.querySelector("#study-ai-new-chat");
const messagesElement = document.querySelector("#study-ai-messages");
const chatForm = document.querySelector("#study-ai-form");
const input = document.querySelector("#study-ai-input");
const sendButton = document.querySelector("#study-ai-send");
const graphButton = document.querySelector("#study-ai-graph");
const statusElement = document.querySelector("#study-ai-status");

const state = {
  session: null,
  messages: [],
  pending: false,
  request: null,
  remaining: null
};

function createMessage(role, content = "", pending = false) {
  const article = document.createElement("article");
  article.className = `study-ai-message study-ai-message-${role}`;
  const label = document.createElement("span");
  label.className = "study-ai-message-label";
  label.textContent = role === "user" ? "You" : "Room 310 Study AI";
  const body = document.createElement("div");
  body.className = "study-ai-message-body";
  article.append(label, body);
  messagesElement.append(article);

  const update = (value) => {
    body.innerHTML = markdown(value);
    decorateMarkdown(body);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  };
  if (pending) {
    body.innerHTML = '<span class="study-ai-typing" aria-label="Room 310 Study AI is thinking"><i></i><i></i><i></i></span>';
  } else {
    update(content);
  }
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return { article, body, label, update };
}

function welcomeMessage() {
  const subject = subjectSelect.value;
  return `Hi—I’m **Room 310 Study AI**. Tell me what you’re learning in ${subject}, or show me where you’re stuck. We’ll work through it together.`;
}

function resetChat({ focus = false } = {}) {
  state.messages = [];
  state.remaining = null;
  messagesElement.replaceChildren();
  createMessage("assistant", welcomeMessage());
  statusElement.textContent = "Enter to send · Shift+Enter for a new line";
  input.value = "";
  resizeInput();
  if (focus) input.focus();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function setPending(pending) {
  state.pending = pending;
  messagesElement.setAttribute("aria-busy", String(pending));
  input.disabled = pending;
  sendButton.disabled = pending;
  graphButton.disabled = pending || !state.session || !["Math", "Science"].includes(subjectSelect.value);
  subjectSelect.disabled = pending || !state.session;
  newChatButton.disabled = pending || !state.session;
  chatPanel.dataset.state = pending ? "working" : "idle";
}

function updateGraphAction() {
  const available = ["Math", "Science"].includes(subjectSelect.value);
  graphButton.hidden = !available;
  graphButton.disabled = state.pending || !state.session || !available;
}

function showLoginMessage(text, status = "error") {
  loginMessage.textContent = text;
  loginMessage.dataset.state = status;
}

function applySession(session) {
  const validSession = session?.access_token && session.user && !session.user.is_anonymous ? session : null;
  const previousUserId = state.session?.user?.id || null;
  const nextUserId = validSession?.user?.id || null;
  state.session = validSession;
  if (previousUserId && previousUserId !== nextUserId) resetChat();
  authPanel.hidden = Boolean(validSession);
  chatPanel.hidden = !validSession;
  account.hidden = !validSession;
  subjectSelect.disabled = !validSession;
  newChatButton.disabled = !validSession;
  updateGraphAction();
  accessLabel.textContent = validSession ? "Tutor online" : "Sign-in required";
  userLabel.textContent = validSession ? (validSession.user.email || "Room310 account") : "";
  if (validSession && messagesElement.childElementCount === 0) resetChat();
}

function isGraphRequest(question) {
  return ["Math", "Science"].includes(subjectSelect.value)
    && (/^\s*(?:please\s+)?(?:graph|plot|visuali[sz]e)\b/i.test(question)
      || /\b(?:make|create|draw|show|generate)\s+(?:me\s+)?(?:an?\s+)?(?:interactive\s+)?graph\b/i.test(question));
}

function renderGraph(message, result) {
  message.article.classList.add("study-ai-message-graph");
  const caption = document.createElement("div");
  caption.className = "study-ai-graph-caption";
  caption.textContent = "Interactive graph · change equations, zoom, and explore";
  const frame = document.createElement("iframe");
  frame.className = "study-ai-graph-frame";
  frame.title = "Interactive Desmos graph created for this Study AI question";
  frame.src = "/study-graph-runner.html";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.addEventListener("load", () => {
    frame.contentWindow?.postMessage({
      type: "room310-graph",
      apiKey: result.desmosApiKey,
      expressions: result.expressions,
      bounds: result.bounds
    }, "*");
  }, { once: true });
  message.body.append(caption, frame);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

async function readJsonError(response) {
  try {
    const result = await response.json();
    return result?.error || "Study AI could not complete that request.";
  } catch {
    return "Study AI returned an unreadable response. Please try again.";
  }
}

async function streamTutorResponse(response, assistantMessage) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Study AI returned an empty response. Please try again.");
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const handleLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("Study AI returned an unreadable response. Please try again.");
    }
    if (event.type === "meta" && Number.isInteger(event.remaining)) state.remaining = event.remaining;
    if (event.type === "delta" && typeof event.text === "string") {
      answer += event.text;
      assistantMessage.update(answer);
      statusElement.textContent = "Room 310 Study AI is writing…";
    }
    if (event.type === "error") throw new Error(event.error || "The tutor could not finish that response.");
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
  if (!answer.trim()) throw new Error("The tutor did not return an answer. Please try again.");
  return answer;
}

async function sendQuestion(forceGraph = false) {
  const question = input.value.trim();
  if (!question || state.pending || !state.session) return;
  const graphRequest = forceGraph || isGraphRequest(question);

  state.messages.push({ role: "user", content: question });
  createMessage("user", question);
  input.value = "";
  resizeInput();
  setPending(true);
  statusElement.textContent = graphRequest ? "Building an interactive graph…" : "Room 310 Study AI is thinking…";
  const assistantMessage = createMessage("assistant", "", true);
  const controller = new AbortController();
  state.request = controller;

  try {
    const response = await fetch("/api/study", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...(graphRequest ? { mode: "graph" } : {}),
        subject: subjectSelect.value,
        messages: state.messages.slice(-20)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(await readJsonError(response));
      error.status = response.status;
      throw error;
    }
    if (graphRequest) {
      const result = await response.json();
      if (typeof result.explanation !== "string" || !Array.isArray(result.expressions)
        || !result.expressions.length || !result.bounds || typeof result.desmosApiKey !== "string") {
        throw new Error("Study AI returned an incomplete graph. Please try again.");
      }
      assistantMessage.update(result.explanation);
      renderGraph(assistantMessage, result);
      state.messages.push({ role: "assistant", content: `${result.explanation}\nGraph: ${result.expressions.map((item) => item.latex).join("; ")}` });
      if (Number.isInteger(result.remaining)) state.remaining = result.remaining;
    } else {
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
        throw new Error("Study AI returned an unreadable response. Please try again.");
      }
      const answer = await streamTutorResponse(response, assistantMessage);
      state.messages.push({ role: "assistant", content: answer });
    }
    statusElement.textContent = Number.isInteger(state.remaining)
      ? `${state.remaining} questions remaining this hour · Enter to send`
      : "Enter to send · Shift+Enter for a new line";
  } catch (error) {
    assistantMessage.article.dataset.state = "error";
    assistantMessage.label.textContent = "Study AI notice";
    assistantMessage.update(error.name === "AbortError" ? "That response was stopped." : error.message);
    statusElement.textContent = "Your chat is still here. You can try again.";
    if (error.status === 401) await supabase.auth.signOut();
  } finally {
    state.request = null;
    setPending(false);
    input.focus();
  }
}

if (!isConfigured) {
  accessLabel.textContent = "Setup needed";
  showLoginMessage(configurationMessage);
  loginForm.querySelector("button").disabled = true;
} else {
  supabase.auth.getSession()
    .then(({ data }) => applySession(data.session))
    .catch(() => applySession(null));

  supabase.auth.onAuthStateChange((_event, session) => applySession(session));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector("button");
    const data = new FormData(loginForm);
    button.disabled = true;
    showLoginMessage("Checking your account…", "working");
    try {
      const { data: signedIn, error } = await supabase.auth.signInWithPassword({
        email: String(data.get("email") || "").trim(),
        password: String(data.get("password") || "")
      });
      if (error) throw error;
      applySession(signedIn.session);
      showLoginMessage("");
      loginForm.reset();
      input.focus();
    } catch (error) {
      showLoginMessage(messageFor(error, "Sign in failed. Check your email and password."));
    } finally {
      button.disabled = false;
    }
  });
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendQuestion();
});

graphButton.addEventListener("click", () => sendQuestion(true));

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
input.addEventListener("input", resizeInput);

subjectSelect.addEventListener("change", () => {
  updateGraphAction();
  if (!state.messages.length) resetChat();
  else statusElement.textContent = `${subjectSelect.value} selected for your next question.`;
});

newChatButton.addEventListener("click", () => resetChat({ focus: true }));
signOutButton.addEventListener("click", async () => {
  state.request?.abort();
  await supabase.auth.signOut();
  resetChat();
});
