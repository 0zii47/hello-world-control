import CDP from "chrome-remote-interface";

const DEFAULT_CDP_PORT = 9222;

export async function getTargets(port = DEFAULT_CDP_PORT) {
  const resp = await fetch(`http://localhost:${port}/json`);
  if (!resp.ok) {
    throw new Error(`CDP not reachable on port ${port}: HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function findWhatsAppTarget(port = DEFAULT_CDP_PORT) {
  const targets = await getTargets(port);
  return targets.filter(
    (t) =>
      (t.type === "webview" || t.type === "page") &&
      (t.url.includes("localhost:1842") ||
        t.url.includes("web.whatsapp.com"))
  );
}

export async function executeInWebView(targetId, expression, port = DEFAULT_CDP_PORT) {
  const client = await CDP({ target: targetId, port });
  try {
    await client.Runtime.enable();
    const result = await client.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: 15000,
    });
    return result;
  } finally {
    await client.close();
  }
}

export async function checkCdpAvailable(port = DEFAULT_CDP_PORT) {
  try {
    const resp = await fetch(`http://localhost:${port}/json`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
