// supabaseClient.js (ESM)
// Pega tus credenciales aquí (Settings -> API en Supabase):
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
//
// IMPORTANTE: NO uses Service Role Key en frontend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
export const SUPABASE_ANON_KEY = "TU_SUPABASE_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});