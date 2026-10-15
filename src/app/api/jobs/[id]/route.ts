import { cancelJob, getJob } from "@/lib/kb/jobs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]">,
) {
  const job = getJob((await context.params).id);
  return job
    ? Response.json(job)
    : Response.json({ error: "Job not found" }, { status: 404 });
}

/** Cancel a running job. */
export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/jobs/[id]">,
) {
  const job = cancelJob((await context.params).id);
  return job
    ? Response.json(job)
    : Response.json({ error: "Job not found" }, { status: 404 });
}
