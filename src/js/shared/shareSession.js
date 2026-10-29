const SHARE_TOKEN_KEY = "caseShareToken";

export function readShareToken() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fromUrl = fragment.get("share");
  if (fromUrl) {
    sessionStorage.setItem(SHARE_TOKEN_KEY, JSON.stringify({ token: fromUrl, search: window.location.search }));
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return fromUrl;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(SHARE_TOKEN_KEY) || "null");
    return saved?.search === window.location.search ? saved.token : null;
  } catch {
    return null;
  }
}

export function clearShareToken() {
  sessionStorage.removeItem(SHARE_TOKEN_KEY);
}

