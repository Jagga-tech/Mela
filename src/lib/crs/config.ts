import "server-only";
import { CRS_SANDBOX_BASE_URL } from "./client";
import type { OfacConfig } from "./checks";

// Every environment variable the CRS module reads is read here, on the server only.
// Names match CRS's own MCP server (CRS_USERNAME / CRS_PASSWORD).

export class CrsConfigError extends Error {
  override name = "CrsConfigError";
}

export interface CrsConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** null when the Bridger (OFAC) config isn't set: the OFAC check then reports not_configured. */
  ofac: OfacConfig | null;
}

export function getCrsConfig(env: NodeJS.ProcessEnv = process.env): CrsConfig {
  const username = env.CRS_USERNAME?.trim();
  const password = env.CRS_PASSWORD;
  if (!username || !password) throw new CrsConfigError("CRS_USERNAME and CRS_PASSWORD are not set.");
  const config = env.CRS_XGS_CONFIG?.trim();
  const glbPurpose = env.CRS_XGS_GLB_PURPOSE?.trim();
  const dlPurpose = env.CRS_XGS_DL_PURPOSE?.trim();
  return {
    baseUrl: env.CRS_BASE_URL?.trim() || CRS_SANDBOX_BASE_URL,
    username,
    password,
    ofac: config && glbPurpose && dlPurpose ? { config, glbPurpose, dlPurpose, searchType: env.CRS_XGS_SEARCH_TYPE?.trim() || undefined } : null,
  };
}
