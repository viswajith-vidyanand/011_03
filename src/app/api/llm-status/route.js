import { geminiConfig } from "@/lib/extract/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  const { configured, provider, model } = geminiConfig();
  return Response.json({ configured, provider, model });
}
