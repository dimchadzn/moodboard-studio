import type { User } from "@supabase/supabase-js";
import { MoodboardStudio } from "@/components/moodboard-studio";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let initialUser: User | null = null;
  const isSupabaseConfigured = hasSupabaseEnv();

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    initialUser = user;
  }

  return (
    <MoodboardStudio
      initialUser={initialUser}
      isSupabaseConfigured={isSupabaseConfigured}
    />
  );
}
