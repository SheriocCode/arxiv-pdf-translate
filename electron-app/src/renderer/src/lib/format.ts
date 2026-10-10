export function formatSize(bytes?: number): string {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return value.toFixed(index === 0 ? 0 : 1) + " " + units[index];
}

export function formatTime(seconds?: number): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : "";
}

export function formatDate(seconds?: number): string {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "—";
}
