export function fmtLength(v: number, units = "m", decimals = 3): string {
  return `${v.toFixed(decimals)} ${units}`;
}

export function fmtSigned(v: number, units = "m", decimals = 3): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(decimals)} ${units}`;
}

export function fmtCoord(v: number, decimals = 3): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false });
}

export function fmtCount(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}
