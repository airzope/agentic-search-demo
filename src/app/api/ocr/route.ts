import { ocrHealth } from "@/lib/kb/ocr";

export async function GET() {
  return Response.json(await ocrHealth());
}
