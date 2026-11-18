const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ACCOUNT = /\b[a-f0-9]{32}\b/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

export function redact(text, secrets = []) {
  let out = String(text);
  const unique = [...new Set(secrets.filter((item) => typeof item === "string" && item.length >= 6))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(BEARER, "Bearer [redacted]");
  out = out.replace(UUID, "[redacted]");
  out = out.replace(ACCOUNT, "[redacted]");
  out = out.replace(/https?:\/\/[^\s)]+/g, (url) => sanitizeUrl(url));
  return out;
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "https:" &&
      parsed.hostname === "cfnew-backup.pages.dev" &&
      (parsed.pathname === "/" || parsed.pathname === "") &&
      parsed.search === "" &&
      parsed.hash === ""
    ) {
      return "https://cfnew-backup.pages.dev/";
    }
    const hostOk =
      parsed.protocol === "https:" &&
      (parsed.hostname === "github.com" ||
        parsed.hostname === "api.github.com" ||
        parsed.hostname.endsWith(".githubusercontent.com"));
    if (hostOk) return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[redacted-url]";
  }
  return "[redacted-url]";
}
