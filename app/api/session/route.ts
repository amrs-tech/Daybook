import { z } from "zod";
import {
  checkOrigin,
  owner,
  cookieName,
  localEnabled,
  makeLocalSession,
  supabase,
} from "@/lib/auth";
import { json, ok, failure } from "@/lib/http";
import { workspace } from "@/lib/workflow";
import { DomainError } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const id = await owner(req);
    const context = await workspace(id);
    return ok({
      context,
      localReplay:
        localEnabled() &&
        !(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL_ID),
      voiceAvailable: !!process.env.ELEVENLABS_API_KEY,
      modelId: process.env.GEMINI_MODEL_ID || null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const data = await json(
      req,
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("local") }).strict(),
        z
          .object({
            mode: z.literal("password"),
            email: z.string().email().max(254),
            password: z.string().min(1).max(200),
          })
          .strict(),
      ]),
    );
    let token: string;
    if (data.mode === "local") token = makeLocalSession();
    else {
      const result = await supabase().auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (result.error || !result.data.session)
        throw new DomainError("SIGN_IN_FAILED", 401);
      token = result.data.session.access_token;
    }
    const response = ok({ signedIn: true });
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: data.mode === "local" ? 43200 : 3500,
    });
    return response;
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const response = ok({ signedOut: true });
    response.cookies.delete(cookieName);
    return response;
  } catch (e) {
    return failure(e);
  }
}
