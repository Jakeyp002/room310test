import { configurationMessage, getManager, isConfigured, messageFor, supabase } from "./supabase-client.js";

const form = document.querySelector("#admin-login-form");
const message = document.querySelector("#login-message");

function showMessage(text, state = "error") {
  message.textContent = text;
  message.dataset.state = state;
}

if (!isConfigured) {
  showMessage(configurationMessage);
  form.querySelector("button").disabled = true;
} else {
  getManager()
    .then((manager) => {
      if (manager) location.replace("/admin/games");
    })
    .catch(() => {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    const data = new FormData(form);
    button.disabled = true;
    showMessage("Checking your account…", "working");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: String(data.get("email") || "").trim(),
        password: String(data.get("password") || "")
      });
      if (error) throw error;

      const manager = await getManager();
      if (!manager) {
        await supabase.auth.signOut();
        showMessage("Your account is not approved to manage Room310 games.");
        return;
      }

      showMessage("Signed in. Opening the dashboard…", "success");
      location.assign("/admin/games");
    } catch (error) {
      showMessage(messageFor(error, "Sign in failed. Check your email and password."));
    } finally {
      button.disabled = false;
    }
  });
}
