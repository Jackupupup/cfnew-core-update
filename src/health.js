import { HEALTH_URL } from "./constants.js";

export function evaluateHealth({ status, body, contentType, location }) {
  if (location) return { ok: false, reason: "redirect", status: status ?? 0 };
  if (status !== 200) {
    const bodyLength = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body ?? ""));
    return { ok: false, reason: "status", status: status ?? 0, bodyLength };
  }
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  if (text !== "hello") {
    return { ok: false, reason: "body", status, bodyLength: Buffer.byteLength(text) };
  }
  if (contentType && !String(contentType).toLowerCase().startsWith("text/plain")) {
    return { ok: false, reason: "content-type", status };
  }
  return { ok: true, status: 200 };
}

export { HEALTH_URL };
