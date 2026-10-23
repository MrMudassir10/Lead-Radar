import { describe, expect, it } from "vitest";
import { parseCsv, parseLeads } from "@/lib/csvImport";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, line breaks in cells, BOM and CRLF", () => {
    const t = parseCsv('﻿name,note\r\n"Smith, Inc","said ""hi"""\r\n"Two\nLines",x\r\n');
    expect(t).toEqual([["name", "note"], ["Smith, Inc", 'said "hi"'], ["Two\nLines", "x"]]);
  });
  it("detects semicolon and tab separators", () => {
    expect(parseCsv("a;b\n1;2")[1]).toEqual(["1", "2"]);
    expect(parseCsv("a\tb\n1\t2")[1]).toEqual(["1", "2"]);
  });
});

describe("parseLeads", () => {
  it("maps flexible headers and cleans values", () => {
    const r = parseLeads("Company Name,URL,Telephone,E-mail,Sector,Town,Year\nAcme,acme.com,555,BAD EMAIL,HVAC,Boise,1990\nAcme,https://www.acme.com,555,,HVAC,Boise,1990\n,x.com,,,,,\n");
    expect(r.error).toBeUndefined();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: "Acme", website: "https://acme.com/", phone: "555", email: null, industry: "HVAC", city: "Boise", foundedYear: 1990 });
    expect(r.skipped).toBe(2);
  });
  it("errors clearly when there is no name column", () => {
    expect(parseLeads("foo,bar\n1,2").error).toContain("business name column");
  });
  it("errors on an empty file", () => {
    expect(parseLeads("name").error).toBeDefined();
  });
});
