import { verifyShipment } from "@/lib/verification";
import { runComparison } from "@/lib/verification";

export async function POST(request) {
  try {
    const result = runComparison(await request.json());
    if (result.error) return Response.json(result, { status: 400 });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Send valid JSON containing extracted documents." }, { status: 400 });
export async function POST(request) {
  try {
    const payload = await request.json();
    const result = verifyShipment(payload);
    if (result.error) return Response.json(result, { status: 400 });
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "Send valid JSON with a documents array." }, { status: 400 });
  }
}
>>>>>>> 2e57860561e2de5300b8fb63bbbd3a4c90e2a5d8
  }
}
