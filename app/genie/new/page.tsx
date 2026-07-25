import { redirect } from "next/navigation";

/**
 * Ad-hoc Genie space creation is now handled inline via the GenieBuilderModal
 * in Ask Forge. Redirect any direct navigation here to Ask Forge.
 */
export default function NewGenieSpaceRedirect() {
  redirect("/ask-forge");
}
