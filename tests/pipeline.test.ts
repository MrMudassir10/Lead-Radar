import { describe, expect, it } from "vitest";
import { isPrivateIp, parseSite } from "@/lib/enrich";
import { buildQuery, normalizeUrl, parseElements } from "@/lib/osm";

describe("parseSite", () => {
  const html = `<html><head><meta name="viewport" content="width=device-width"></head><body>
    <a href="mailto:Owner@Acme.com?subject=Hi">Email us</a>
    <a href="tel:+1-208-555-0100">Call</a>
    <p>Family owned and operated since 1994. Book online today. We're hiring technicians.</p>
    <a href="https://facebook.com/acme">fb</a><img src="logo@2x.png">
    <script>var e="hidden@tracker.sentry.io"</script></body></html>`;
  const f = parseSite(html, "https://acme.com/");
  it("finds contact details", () => {
    expect(f.emails).toEqual(["owner@acme.com"]);
    expect(f.phones[0]).toContain("208");
  });
  it("detects signals and founding year", () => {
    expect(f.signals).toEqual(expect.arrayContaining(["online_booking", "hiring", "family_owned", "social"]));
    expect(f.signals).not.toContain("no_mobile");
    expect(f.foundedYear).toBe(1994);
  });
  it("flags a site with no booking, no viewport, and no https", () => {
    const g = parseSite("<html><body>Plumbing since 2005</body></html>", "http://old.com");
    expect(g.signals).toEqual(expect.arrayContaining(["no_booking", "no_mobile", "no_https"]));
  });
});

describe("isPrivateIp", () => {
  it("blocks internal ranges and allows public ones", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.5", "169.254.169.254", "::1", "fd00::1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34"]) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("OpenStreetMap helpers", () => {
  it("builds an Overpass query for the industry", () => {
    const q = buildQuery("Dental", { south: 1, west: 2, north: 3, east: 4 }, 50);
    expect(q).toContain('"amenity"="dentist"');
    expect(q).toContain("(1,2,3,4)");
  });
  it("normalizes websites", () => {
    expect(normalizeUrl("acme.com")).toBe("https://acme.com/");
    expect(normalizeUrl("nonsense")).toBeNull();
  });
  it("parses elements and skips unnamed ones", () => {
    const out = parseElements(
      [
        { type: "node", id: 1, lat: 1, lon: 2, tags: { name: "A Dental", website: "adental.com", "contact:phone": "555", start_date: "1999-01-01", "addr:street": "Main St", "addr:housenumber": "5" } },
        { type: "way", id: 2, center: { lat: 3, lon: 4 }, tags: { amenity: "dentist" } },
      ],
      "Dental",
      "Boise",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ osmId: "node/1", website: "https://adental.com/", phone: "555", foundedYear: 1999, city: "Boise", address: "5 Main St" });
  });
});
