// Tiny .env.local loader (no dotenv). Existing env vars win.
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch {
  // no .env.local: rely on the real environment
}
