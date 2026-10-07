import { runComparison } from "@/lib/verification";

export async function POST(request) {
  try {
    const result = runComparison(await request.json());
    if (result.error) return Response.json(result, { status: 400 });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Send valid JSON containing extracted documents." }, { status: 400 });
  }
}
