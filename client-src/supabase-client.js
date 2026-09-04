import { createClient } from "@supabase/supabase-js";

const config = globalThis.ROOM310_SUPABASE_CONFIG || {};

export const isConfigured = Boolean(config.projectUrl && config.publishableKey);
export const supabase = isConfigured
  ? createClient(config.projectUrl, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;

export const configurationMessage = "Room310's Supabase connection is not configured on this deployment yet.";

export async function getManager() {
  if (!supabase) throw new Error(configurationMessage);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,display_name,role,approved")
    .eq("id", userData.user.id)
    .single();

  if (profileError) throw profileError;
  if (!profile.approved || !["admin", "editor"].includes(profile.role)) return null;
  return { user: userData.user, profile };
}

export function messageFor(error, fallback = "The request could not be completed.") {
  if (!error) return fallback;
  if (error.code === "23505") return "That value is already in use. Try again.";
  if (error.code === "23514") return "One of the values does not meet the publishing rules.";
  return error.message || fallback;
}
