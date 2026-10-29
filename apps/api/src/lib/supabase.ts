import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return { url, key };
}

/** Cookie-backed Supabase client. Session refreshes are written back as cookies. */
export async function cookieSupabase() {
  const { url, key } = env();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

/** Stateless client for Bearer-token callers (bots, scripts). */
export function plainSupabase() {
  const { url, key } = env();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
