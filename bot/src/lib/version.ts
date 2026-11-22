// The one game version the pinned packages and scripts/patch-26.3.js give correct data for.
export const SUPPORTED_VERSION = "26.3";

// Auto-detect would pick whatever the server says and run on data that doesn't match it, so the
// version is fixed and a different MC_VERSION is a startup error.
export function resolveVersion(requested: string | undefined): string {
  if (requested && requested !== SUPPORTED_VERSION) {
    throw new Error(`MC_VERSION ${requested} is not supported, the bot is patched for ${SUPPORTED_VERSION} only`);
  }
  return SUPPORTED_VERSION;
}
