import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";

/**
 * Render an async Server Component to HTML.
 *
 * `@testing-library/react` cannot: its renderer is the client one, which has no
 * way to await a component. Fizz can, and that is enough for the questions this
 * repo asks of a server tree — what got rendered, and what requests were made
 * while rendering it.
 *
 * What it is not is a Next.js runtime. There is no router, no request scope and
 * no RSC serialisation, so a component that reaches for those has to be tested
 * some other way. `redirect()` still works: it throws, and the throw comes back
 * out of this promise.
 */
export async function renderServerComponent(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream as unknown as ReadableStream).text();
}
