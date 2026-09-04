(() => {
  "use strict";
  const form = document.querySelector("#admin-login-form");
  const message = document.querySelector("#login-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = "Checking your account…";
    const data = new FormData(form);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign in failed.");
      if (!result.user.approved) {
        message.textContent = "Your account exists but has not been approved yet.";
        return;
      }
      location.assign("/admin/games");
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
