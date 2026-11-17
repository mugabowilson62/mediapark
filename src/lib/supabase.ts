import { createClient } from "@supabase/supabase-js";

// These are the project's public browser credentials. Never put a service-role key here.
const supabaseUrl = "https://gvhaekbiwcqqwlysdjnc.supabase.co";
const supabasePublishableKey = "sb_publishable_fGt8-WWP7KeRW9Xz2PAG0A__lJOavS5";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
