/**
 * Liveness probe.
 *
 * Deliberately outside the session gate: a load balancer has no cookie, and a
 * health endpoint that redirects to Keycloak reports the panel as down every
 * time Keycloak hiccups — which is the opposite of what it is for. It says
 * nothing about the session layer and asks Keycloak nothing.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "UP" }, { headers: { "Cache-Control": "no-store" } });
}
