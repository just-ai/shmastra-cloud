export const API = window.location.origin;

export function timeAgo(dateStr) {
  if (!dateStr) return "-";
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return sec + "s ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const d = Math.floor(hr / 24);
  return d + "d ago";
}

export function parseSSE(text) {
  const events = [];
  const lines = text.split("\n");
  let current = {};
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      current.event = line.slice(7);
    } else if (line.startsWith("data: ")) {
      current.data = line.slice(6);
    } else if (line === "" && current.event) {
      try { current.data = JSON.parse(current.data); } catch {}
      events.push(current);
      current = {};
    }
  }
  return events;
}
