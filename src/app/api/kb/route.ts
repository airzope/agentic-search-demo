import { listKnowledgeBases } from "@/lib/kb/catalog";
import { createKnowledgeBase, type CreateKbInput } from "@/lib/kb/manage";
import { handle } from "@/lib/meili";

export async function GET() {
  return handle(async () => Response.json(await listKnowledgeBases()));
}

/** Create a knowledge base (optionally mapped to a local directory). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = (await request.json()) as CreateKbInput;
    return Response.json(await createKnowledgeBase(input), { status: 201 });
  });
}
