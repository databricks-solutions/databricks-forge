/**
 * /portfolio — legacy route, now consolidated into the Estate interface.
 *
 * The cross-estate Portfolio (CDO) roll-up is a top-level tab on /environment.
 * This route permanently redirects in so existing links / bookmarks keep
 * working; access control still lives server-side in requirePortfolioAccess on
 * every /api/portfolio* route (the tab only renders for portfolio admins).
 */

import { redirect } from "next/navigation";

export default function PortfolioPage() {
  redirect("/environment?tab=portfolio");
}
