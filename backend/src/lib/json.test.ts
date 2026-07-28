import { describe, it, expect } from "bun:test";
import { extractJsonObject, parseJsonObject } from "./json";

describe("extractJsonObject", () => {
  it("pulls JSON out of a ```json fence", () => {
    expect(extractJsonObject('Here:\n```json\n{"a":1}\n```\nthanks')).toBe('{"a":1}');
  });
  it("pulls JSON from bare braces amid prose", () => {
    expect(extractJsonObject('blah {"a":1} tail')).toBe('{"a":1}');
  });
  it("returns null for empty input", () => {
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("parseJsonObject", () => {
  it("parses fenced JSON to an object", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws on non-JSON output", () => {
    expect(() => parseJsonObject("sorry, I can't do that")).toThrow();
  });
});
