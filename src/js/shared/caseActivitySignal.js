import { apiUrl, callerIdentity } from "./api.js";

const pending = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (pending.length) {
      const entry = pending[0];
      let status = 503;
      try {
        const res = await fetch(apiUrl("case/activity/signal"), {
          ...entry.request,
          signal: AbortSignal.timeout(8000),
        });
        status = res.status;
      } catch {
        // Retry once with the same operation ID.
      }
      if ((status >= 500 || status === 429) && entry.retries > 0) {
        entry.retries -= 1;
        await new Promise(resolve => setTimeout(resolve, status === 429 ? 1000 : 350));
      } else {
        pending.shift();
      }
    }
  } finally {
    draining = false;
  }
}

export function reportCaseActivity(caseId, action, outcome = "reported", shareToken = null) {
  const caseIntID = Number(caseId);
  const caller = shareToken ? {} : callerIdentity();
  if (!Number.isSafeInteger(caseIntID) || caseIntID <= 0 ||
      (!shareToken && !caller.uuid) || !globalThis.crypto?.randomUUID || pending.length >= 100) return;

  pending.push({
    retries: 1,
    request: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(shareToken ? { Authorization: `Bearer ${shareToken}` } : {}),
      },
      body: JSON.stringify([caller, { caseIntID, action, outcome, operation: crypto.randomUUID() }]),
      keepalive: true,
    },
  });
  void drain();
}

// Older API deployments do not have the audited write routes yet.
export async function auditedCaseWrite(path, caller, payload, legacyPath, legacyMethod, legacyPayload) {
  const post = (url, method, data) => fetch(apiUrl(url), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data === undefined ? [caller] : [caller, data]),
  });
  const operation = globalThis.crypto?.randomUUID?.();
  if (operation) {
    const res = await post(`case/activity/${path}`, "POST", { ...payload, operation });
    if (res.status !== 404 || !res.headers?.get("content-type")?.includes("text/html")) return res;
  }
  return post(legacyPath, legacyMethod, legacyPayload);
}
