import { UpdateError } from "./errors.js";
import { DOWNLOAD_HOSTS, LIMITS } from "./constants.js";

const HOSTS = new Set(DOWNLOAD_HOSTS);

export async function downloadBounded(url, { fetchImpl, headers, maxBytes, redirects = 3 }) {
  let current = assertHttpsHost(url);
  const fetchFn = fetchImpl;
  for (let hop = 0; hop <= redirects; hop += 1) {
    const response = await fetchFn(current, {
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === redirects) throw new UpdateError("redirect");
      current = assertHttpsHost(new URL(location, current).href);
      continue;
    }
    if (response.status !== 200) throw new UpdateError("download-status");
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > maxBytes) throw new UpdateError("download-size");
    return readBodyLimited(response, maxBytes);
  }
  throw new UpdateError("redirect");
}

export function assertHttpsHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpdateError("download-host");
  }
  if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new UpdateError("download-host");
  }
  return parsed;
}

export async function readBodyLimited(response, maxBytes) {
  const cap = maxBytes ?? LIMITS.maxDownloadBytes;
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffered = Buffer.from(await response.arrayBuffer());
    if (buffered.length > cap) throw new UpdateError("download-size");
    return buffered;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new UpdateError("download-size");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
