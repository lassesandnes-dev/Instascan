import type { PointCloud } from "./pointcloud";

export interface XyzParseOptions {
  /** Hard cap on number of points accepted (protects memory). */
  maxPoints?: number;
  /** Maximum number of malformed lines tolerated before the parse fails. */
  maxInvalidLines?: number;
}

export interface XyzParseWarning {
  line: number;
  message: string;
}

export interface XyzParseResult {
  cloud: PointCloud;
  delimiter: "," | ";" | "\t" | " ";
  /** Column names when a header row was found, otherwise null. */
  header: string[] | null;
  /** Column indices used for x, y, z (and optional colour / intensity). */
  columns: { x: number; y: number; z: number; r?: number; g?: number; b?: number; intensity?: number };
  skippedLines: number;
  warnings: XyzParseWarning[];
}

export class XyzParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = "XyzParseError";
  }
}

const DEFAULT_MAX_POINTS = 20_000_000;
const DEFAULT_MAX_INVALID = 100;

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function detectDelimiter(sample: string): XyzParseResult["delimiter"] {
  if (sample.includes("\t")) return "\t";
  if (sample.includes(";")) return ";";
  if (sample.includes(",")) return ",";
  return " ";
}

function splitLine(line: string, delimiter: XyzParseResult["delimiter"]): string[] {
  if (delimiter === " ") return line.trim().split(/\s+/);
  return line.split(delimiter).map((s) => s.trim());
}

const HEADER_ALIASES: Record<string, string[]> = {
  x: ["x", "e", "east", "easting", "y_east", "lon", "longitude"],
  y: ["y", "n", "north", "northing", "x_north", "lat", "latitude"],
  z: ["z", "h", "height", "elevation", "elev", "alt", "altitude"],
  r: ["r", "red"],
  g: ["g", "green"],
  b: ["b", "blue"],
  intensity: ["i", "intensity", "int"],
};

function mapHeader(header: string[]): XyzParseResult["columns"] | null {
  const norm = header.map((h) => h.toLowerCase().replace(/^["']|["']$/g, "").trim());
  const find = (key: string) => norm.findIndex((h) => HEADER_ALIASES[key]!.includes(h));
  const x = find("x");
  const y = find("y");
  const z = find("z");
  if (x < 0 || y < 0 || z < 0) return null;
  const cols: XyzParseResult["columns"] = { x, y, z };
  const r = find("r");
  const g = find("g");
  const b = find("b");
  if (r >= 0 && g >= 0 && b >= 0) Object.assign(cols, { r, g, b });
  const intensity = find("intensity");
  if (intensity >= 0) cols.intensity = intensity;
  return cols;
}

/**
 * Parse an ASCII XYZ / CSV point list.
 *
 * Accepts comma, semicolon, tab or whitespace delimiters; optional header row
 * (x/y/z, easting/northing/height …); `#` and `//` comments; an optional
 * leading point-count line (PTS style); and optional r,g,b / intensity
 * columns. Without a header the column order is x y z [r g b] or x y z [i r g b].
 *
 * The file content is treated strictly as data – it is never evaluated.
 * No coordinate conversion is performed: values are returned exactly as read.
 */
export function parseXyz(text: string, options: XyzParseOptions = {}): XyzParseResult {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  const maxInvalid = options.maxInvalidLines ?? DEFAULT_MAX_INVALID;

  const lines = text.split(/\r?\n/);
  let firstDataLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l && !l.startsWith("#") && !l.startsWith("//")) {
      firstDataLine = i;
      break;
    }
  }
  if (firstDataLine < 0) throw new XyzParseError("File contains no data");

  const delimiter = detectDelimiter(lines[firstDataLine]!);
  let header: string[] | null = null;
  let columns: XyzParseResult["columns"] | null = null;
  let start = firstDataLine;

  const firstFields = splitLine(lines[firstDataLine]!, delimiter);
  if (firstFields.length === 1 && /^\d+$/.test(firstFields[0]!)) {
    // PTS-style point count line; skip it.
    start = firstDataLine + 1;
  } else if (!firstFields.every((f) => NUMBER_RE.test(f))) {
    header = firstFields;
    columns = mapHeader(firstFields);
    if (!columns) {
      throw new XyzParseError(
        `Unrecognised header "${lines[firstDataLine]!.trim()}". Expected columns named x, y, z (or easting, northing, height).`,
        firstDataLine + 1,
      );
    }
    start = firstDataLine + 1;
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const intensities: number[] = [];
  const warnings: XyzParseWarning[] = [];
  let skipped = 0;
  let fieldCount: number | null = null;

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) continue;
    const lineNo = i + 1;
    const fields = splitLine(raw, delimiter);

    if (!columns) {
      if (fields.length < 3) {
        throw new XyzParseError(`Expected at least 3 numeric columns (x y z), found ${fields.length}`, lineNo);
      }
      columns = { x: 0, y: 1, z: 2 };
      if (fields.length === 6) Object.assign(columns, { r: 3, g: 4, b: 5 });
      else if (fields.length === 7) Object.assign(columns, { intensity: 3, r: 4, g: 5, b: 6 });
      else if (fields.length === 4) columns.intensity = 3;
      fieldCount = fields.length;
    }

    const invalid = (message: string) => {
      skipped++;
      if (warnings.length < 20) warnings.push({ line: lineNo, message });
      if (skipped > maxInvalid) {
        throw new XyzParseError(`Too many malformed lines (>${maxInvalid}). Last problem: ${message}`, lineNo);
      }
    };

    if (fieldCount !== null && fields.length !== fieldCount) {
      invalid(`Expected ${fieldCount} columns, found ${fields.length}`);
      continue;
    }
    const x = Number(fields[columns.x]);
    const y = Number(fields[columns.y]);
    const z = Number(fields[columns.z]);
    if (
      !NUMBER_RE.test(fields[columns.x] ?? "") ||
      !NUMBER_RE.test(fields[columns.y] ?? "") ||
      !NUMBER_RE.test(fields[columns.z] ?? "") ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      invalid("Non-numeric or non-finite coordinate");
      continue;
    }
    if (positions.length / 3 >= maxPoints) {
      throw new XyzParseError(`Point limit exceeded (max ${maxPoints.toLocaleString("en-US")} points)`, lineNo);
    }
    positions.push(x, y, z);
    if (columns.r !== undefined) {
      const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0);
      colors.push(
        clamp(Number(fields[columns.r])),
        clamp(Number(fields[columns.g!])),
        clamp(Number(fields[columns.b!])),
      );
    }
    if (columns.intensity !== undefined) {
      const v = Number(fields[columns.intensity]);
      intensities.push(Number.isFinite(v) ? v : 0);
    }
  }

  const count = positions.length / 3;
  if (count === 0) throw new XyzParseError("File contains no valid points");

  const cloud: PointCloud = { positions: Float64Array.from(positions), count };
  if (colors.length === count * 3) cloud.colors = Uint8Array.from(colors);
  if (intensities.length === count) cloud.intensity = Float32Array.from(intensities);

  return { cloud, delimiter, header, columns: columns!, skippedLines: skipped, warnings };
}
