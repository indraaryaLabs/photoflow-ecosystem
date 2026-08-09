import { createClient } from '@supabase/supabase-js';
// Diimpor demi efek sampingnya, dan urutannya penting: modul ini membaca
// fragment URL, sedangkan createClient di bawah menghapusnya.
import './recovery';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase URL or Anon Key is missing. Please check your .env file.");
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
