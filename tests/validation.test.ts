import { describe, expect, it } from "vitest";
import { validateSearchDate, validateZipCode } from "@/lib/validation";

describe("search input validation", () => {
  it("accepts a five-digit ZIP and rejects malformed ZIPs", () => {
    expect(validateZipCode(" 02139 ")).toBe("02139");
    expect(validateZipCode("1234")).toBeNull();
    expect(validateZipCode("12a45")).toBeNull();
    expect(validateZipCode("12345-6789")).toBeNull();
  });

  it("accepts real ISO dates and rejects invalid dates", () => {
    expect(validateSearchDate("2026-10-17")).toBe("2026-10-17");
    expect(validateSearchDate("2026-02-30")).toBeNull();
    expect(validateSearchDate("17-10-2026")).toBeNull();
  });
});
