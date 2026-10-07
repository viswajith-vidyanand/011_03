import { geminiConfig } from "@/lib/extract/gemini";

export async function GET(request) {
  // Accessing request.headers opts into dynamic execution on every request
  const _ = request?.headers;
  const { configured, provider, model } = geminiConfig();
  return Response.json({ configured, provider, model });
}
