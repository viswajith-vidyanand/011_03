import { verifyShipment } from "@/lib/verification";

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
