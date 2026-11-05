import { ok } from "@/lib/http";
import { localEnabled } from "@/lib/auth";
export async function GET() {
  return ok({
    localDemoAvailable: localEnabled(),
    authConfigured: !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  });
}
