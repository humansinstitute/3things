import { renderHomePage } from "../render/home";

import type { Session } from "../types";

export function handleHome(_url: URL, session: Session | null) {
  const page = renderHomePage({ session });
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
