import { recordAction } from "@/lib/ontology/audit";
import { foundryErrorMessage } from "@/lib/ontology/client";
import { connectionParam, handleOntology } from "@/lib/ontology/http";
import { applyAction, validateAction } from "@/lib/ontology/query";

type ActionBody = {
  action: string;
  parameters?: Record<string, unknown>;
  /** `validate` checks only; `apply` runs it (a person approved it). */
  mode?: "validate" | "apply";
};

/**
 * Validate or apply an ontology action. The assistant can only propose
 * actions; this endpoint is called when a person approves one, and every
 * attempt is written to the audit log.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/ontology/[id]/actions">,
) {
  return handleOntology(async () => {
    const connection = await connectionParam(context.params);
    const body = (await request.json()) as ActionBody;
    const parameters = body.parameters ?? {};
    if (body.mode !== "apply") {
      const { validation } = await validateAction(
        connection,
        body.action,
        parameters,
      );
      return Response.json({ validation });
    }
    const base = {
      at: new Date().toISOString(),
      ontology: connection.id,
      action: body.action,
      parameters,
    };
    try {
      const result = await applyAction(connection, body.action, parameters);
      if (!result.ok) {
        await recordAction({
          ...base,
          outcome: "invalid",
          message: result.validation.messages.join("; "),
        });
        return Response.json(
          {
            ok: false,
            validation: result.validation,
            error:
              result.validation.messages.join("; ") ||
              "The action did not pass validation.",
          },
          { status: 422 },
        );
      }
      await recordAction({ ...base, outcome: "applied", edits: result.edits });
      return Response.json({ ok: true, edits: result.edits ?? null });
    } catch (error) {
      await recordAction({
        ...base,
        outcome: "failed",
        message: foundryErrorMessage(error),
      });
      throw error;
    }
  });
}
