<<<<<<< HEAD
import { runComparison } from "@/lib/verification";

export async function POST(request) {
  try {
    const result = runComparison(await request.json());
    if (result.error) return Response.json(result, { status: 400 });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Send valid JSON containing extracted documents." }, { status: 400 });
=======
import { verifyShipment } from "@/lib/verification";

export async function POST(request) {
  try {
    const payload = await request.json();
    const result = verifyShipment(payload);
    if (result.error) return Response.json(result, { status: 400 });
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "Send valid JSON with a documents array." }, { status: 400 });
>>>>>>> 66b1d4f4bc69369539a949d1847b7fbc19ff4602
  }
}
