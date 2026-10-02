import { describe, expect, it } from "vitest";
import { parseXyz, XyzParseError } from "../src";

describe("parseXyz", () => {
  it("parses whitespace-delimited xyz without header", () => {
    const r = parseXyz("1 2 3\n4 5 6\n");
    expect(r.cloud.count).toBe(2);
    expect(Array.from(r.cloud.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.delimiter).toBe(" ");
    expect(r.header).toBeNull();
  });

  it("parses CSV with header aliases and keeps full Float64 precision", () => {
    const r = parseXyz("Easting,Northing,Height\n598123.456,6643210.789,101.234\n598124.001,6643211.002,101.5\n");
    expect(r.cloud.count).toBe(2);
    expect(r.header).toEqual(["Easting", "Northing", "Height"]);
    expect(r.cloud.positions[0]).toBe(598123.456);
    expect(r.cloud.positions[1]).toBe(6643210.789);
  });

  it("supports semicolon, tab, comments and CRLF", () => {
    const r = parseXyz("# comment\r\n// another\r\n1;2;3\r\n\r\n4;5;6\r\n");
    expect(r.cloud.count).toBe(2);
    expect(r.delimiter).toBe(";");
    expect(parseXyz("1\t2\t3\n").delimiter).toBe("\t");
  });

  it("reads RGB columns (x y z r g b) and intensity (x y z i r g b)", () => {
    const rgb = parseXyz("0 0 0 255 128 0\n1 1 1 10 20 30\n");
    expect(Array.from(rgb.cloud.colors!)).toEqual([255, 128, 0, 10, 20, 30]);
    const irgb = parseXyz("0 0 0 0.5 1 2 3\n");
    expect(Array.from(irgb.cloud.colors!)).toEqual([1, 2, 3]);
    expect(irgb.cloud.intensity![0]).toBeCloseTo(0.5);
  });

  it("skips a PTS point-count line", () => {
    expect(parseXyz("2\n1 2 3\n4 5 6").cloud.count).toBe(2);
  });

  it("skips malformed lines with warnings, up to a limit", () => {
    const r = parseXyz("1 2 3\n1 2 abc\n4 5 6\n");
    expect(r.cloud.count).toBe(2);
    expect(r.skippedLines).toBe(1);
    expect(r.warnings[0]!.line).toBe(2);
    expect(() => parseXyz("1 2 3\nx y z\nx y z\n", { maxInvalidLines: 1 })).toThrow(XyzParseError);
  });

  it("rejects non-finite values, empty files and too few columns", () => {
    expect(parseXyz("1 2 3\n1 2 Infinity\n").skippedLines).toBe(1);
    expect(() => parseXyz("")).toThrow(/no data/);
    expect(() => parseXyz("# only comments\n")).toThrow(/no data/);
    expect(() => parseXyz("1 2\n")).toThrow(/at least 3/);
  });

  it("rejects an unrecognised header", () => {
    expect(() => parseXyz("foo,bar,baz\n1,2,3")).toThrow(/Unrecognised header/);
  });

  it("enforces the point limit", () => {
    expect(() => parseXyz("1 2 3\n4 5 6\n7 8 9\n", { maxPoints: 2 })).toThrow(/Point limit/);
  });

  it("treats content strictly as data (no evaluation)", () => {
    expect(() => parseXyz("x,y,z\nprocess.exit(1),2,3\n", { maxInvalidLines: 0 })).toThrow(XyzParseError);
  });
});
