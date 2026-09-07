/**
 * Liveness probe.
 *
 * Deliberately outside the session gate: a load balancer has no cookie, and a
 * health endpoint that redirected to the sign-in page would report the panel as
 * down every time a session expired — the opposite of what it is for. It says
 * nothing about the session layer and asks the backend nothing.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "UP" }, { headers: { "Cache-Control": "no-store" } });
}
