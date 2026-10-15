import "server-only";

import {
  claimNumbers,
  evidenceNumbers,
  numberFound,
  splitClaims,
  stripCitations,
} from "@/lib/agent/claims";
import { createPiModel } from "@/lib/agent/model";
import {
  collectSources,
  type ChatMessage,
  type ClaimStatus,
  type Source,
  type Verification,
  type VerifiedClaim,
} from "@/lib/agent/types";
import { readDocument } from "@/lib/kb/browse";
import { parseRef } from "@/lib/kb/retrieve";
import type { ResolvedProvider } from "@/lib/settings";

/**
 * Verify an answer claim by claim:
 * 1. deterministic checks — cited numbers exist, and every quantity in the
 *    claim appears in its cited sources (with rounding);
 * 2. a model judge reads each claim next to its cited evidence and says
 *    whether it is supported, partly supported or unsupported.
 */

const EVIDENCE_CHARS = 2400;
const MAX_CLAIMS = 60;

/** The text a source contributes as evidence. */
async function evidenceOf(source: Source) {
  const header = [
    source.kind === "object"
      ? `${source.objectTypeName ?? source.objectType} ${source.primaryKey}`
      : source.kind === "aggregate"
        ? `aggregation on ${source.objectTypeName ?? source.objectType}`
        : source.kind === "function"
          ? `function result`
          : source.kb,
    source.title,
  ]
    .filter(Boolean)
    .join(" — ");
  let body = "";
  if (source.kind === "object") {
    body = JSON.stringify(source.properties ?? {});
  } else if (source.kind === "aggregate" && source.table) {
    body = [
      source.table.columns.join(" | "),
      ...source.table.rows.map((row) =>
        row.map((cell) => JSON.stringify(cell)).join(" | "),
      ),
    ].join("\n");
  } else if (source.kind === "function") {
    body = JSON.stringify(source.value ?? source.snippet ?? null);
  } else {
    // Knowledge-base chunk: re-read it, the stored snippet is an excerpt.
    const ref = parseRef(source.ref);
    if (ref) {
      try {
        const document = await readDocument(ref.kbId, ref.docId, {
          around: ref.chunk,
          window: 1,
          maxChars: EVIDENCE_CHARS,
        });
        body = document.chunks.map((chunk) => chunk.content).join("\n");
      } catch {
        body = "";
      }
    }
    body ||= source.snippet ?? "";
  }
  return `${header}\n${body}`.slice(0, EVIDENCE_CHARS);
}

const JUDGE_PROMPT = `You are a strict fact-checker. Each claim comes from an AI answer and cites numbered sources. Judge every claim only against the evidence of the sources it cites:
- supported: everything the claim states is in the cited evidence or follows directly from it (simple arithmetic included).
- partial: some of it is supported, but part is missing from the evidence, overstated or imprecise.
- unsupported: the cited evidence contradicts it or does not contain it.
- not_factual: no factual content (a heading, transition, question or offer of help).
Claims marked "no citation": answer not_factual if there is no factual content, otherwise unsupported.
Reply with JSON only, no prose: {"results":[{"id":1,"verdict":"supported","reason":"…"}]}. Keep each reason to one short sentence, in the language of the claims.`;

type Verdict = "supported" | "partial" | "unsupported" | "not_factual";

function parseVerdicts(text: string) {
  const verdicts = new Map<number, { verdict: Verdict; reason?: string }>();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return verdicts;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      results?: { id?: number; verdict?: string; reason?: string }[];
    };
    for (const item of parsed.results ?? []) {
      if (
        typeof item.id === "number" &&
        ["supported", "partial", "unsupported", "not_factual"].includes(
          item.verdict ?? "",
        )
      ) {
        verdicts.set(item.id, {
          verdict: item.verdict as Verdict,
          reason: item.reason?.slice(0, 300),
        });
      }
    }
  } catch {
    // unparseable: fall back to the deterministic checks
  }
  return verdicts;
}

async function judge(
  claims: VerifiedClaim[],
  evidence: Map<number, string>,
  provider: ResolvedProvider,
  modelId: string,
  signal: AbortSignal,
) {
  const { model, models } = await createPiModel(provider, modelId);
  const cited = [...new Set(claims.flatMap((claim) => claim.cited))].filter(
    (n) => evidence.has(n),
  );
  const prompt = [
    "Sources:",
    ...cited.map((n) => `[${n}] ${evidence.get(n)}`),
    "",
    "Claims:",
    ...claims.map(
      (claim) =>
        `${claim.id}. ${stripCitations(claim.text)} ${claim.cited.length ? `(cites ${claim.cited.map((n) => `[${n}]`).join("")})` : "(no citation)"}`,
    ),
  ].join("\n");
  const reply = await models.completeSimple(
    model,
    {
      systemPrompt: JUDGE_PROMPT,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    { maxTokens: 8192, signal },
  );
  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    throw new Error(reply.errorMessage || "The model request failed.");
  }
  return parseVerdicts(
    reply.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(""),
  );
}

export async function verifyAnswer({
  messages,
  messageId,
  provider,
  modelId,
  signal,
}: {
  messages: ChatMessage[];
  messageId: string;
  provider: ResolvedProvider | null;
  modelId: string;
  signal: AbortSignal;
}): Promise<Verification> {
  const index = messages.findIndex((message) => message.id === messageId);
  const message = messages[index];
  if (!message || message.role !== "assistant") {
    throw new Error("Answer not found.");
  }
  const sources = collectSources(messages.slice(0, index + 1));
  // The answer is the text after the last tool call; earlier text is the
  // agent narrating its steps.
  const lastTool = message.parts.findLastIndex((part) =>
    part.type.startsWith("tool-"),
  );
  const text = message.parts
    .slice(lastTool + 1)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");

  const claims: VerifiedClaim[] = splitClaims(text)
    .slice(0, MAX_CLAIMS)
    .map((claim, at) => ({
      id: at + 1,
      text: claim.text,
      cited: claim.cited,
      missing: claim.cited.filter((n) => !sources.has(n)),
      numbers: [],
      status: "supported" as ClaimStatus,
    }));

  const evidence = new Map<number, string>();
  await Promise.all(
    [...new Set(claims.flatMap((claim) => claim.cited))]
      .filter((n) => sources.has(n))
      .map(async (n) => evidence.set(n, await evidenceOf(sources.get(n)!))),
  );

  // Deterministic checks.
  for (const claim of claims) {
    const pool = evidenceNumbers(
      claim.cited.map((n) => evidence.get(n) ?? "").join("\n"),
    );
    claim.numbers = claimNumbers(claim.text).map((number) => ({
      text: number.text,
      found: numberFound(number, pool),
    }));
  }

  let verdicts = new Map<number, { verdict: Verdict; reason?: string }>();
  let error: string | undefined;
  if (provider && claims.length) {
    try {
      verdicts = await judge(claims, evidence, provider, modelId, signal);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  for (const claim of claims) {
    const verdict = verdicts.get(claim.id);
    const numbersOk = claim.numbers.every((number) => number.found);
    claim.reason = verdict?.reason;
    if (!claim.cited.length) {
      claim.status = verdict?.verdict === "not_factual" ? "neutral" : "uncited";
    } else if (claim.missing.length === claim.cited.length) {
      claim.status = "unsupported";
    } else if (verdict?.verdict === "unsupported") {
      claim.status = "unsupported";
    } else if (verdict?.verdict === "not_factual") {
      claim.status = "neutral";
    } else if (
      verdict?.verdict === "partial" ||
      !numbersOk ||
      claim.missing.length
    ) {
      claim.status = "partial";
    } else {
      // Without a judge, valid citations and matching numbers are all we know.
      claim.status = verdict ? "supported" : "unjudged";
    }
  }

  const summary: Record<ClaimStatus, number> = {
    supported: 0,
    partial: 0,
    unsupported: 0,
    uncited: 0,
    neutral: 0,
    unjudged: 0,
  };
  for (const claim of claims) summary[claim.status] += 1;

  return {
    messageId,
    at: new Date().toISOString(),
    model: provider ? `${provider.name} · ${modelId}` : undefined,
    judged: verdicts.size > 0,
    error,
    claims,
    summary,
  };
}
