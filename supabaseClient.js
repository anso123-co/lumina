// supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

// 1) Pega tus credenciales:
const SUPABASE_URL = "https://hguwqejcrypslxbcrdgy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Hp1PqdiYBVnptBmgqaxq_w_L7RPfOAB";

// 2) Cliente (persist session para admin)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
