import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gbtqoqcvcgxueienqusn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XdmBMicSzJZoXzBbxUnjQw_Bd5DX1wD";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
