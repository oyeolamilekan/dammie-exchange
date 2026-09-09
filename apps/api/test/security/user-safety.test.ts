import { describe, expect, it } from "vitest";
import {
  NameMatcher,
  isAcceptableAccountName,
} from "../../src/helpers/nameMatcher";
import { toPublicUserResponse } from "../../src/controllers/user.response";

describe("user mutation safety helpers", () => {
  it("allows exact and reordered account names", () => {
    expect(
      isAcceptableAccountName("Ada Nwosu", "Nwosu Ada"),
    ).toBe(true);
    expect(isAcceptableAccountName("Ada N. Nwosu", "Ada Nkem Nwosu")).toBe(true);
    expect(isAcceptableAccountName("Olu-Wale Adebayo", "Adebayo, Olu Wale")).toBe(true);
  });

  it("allows one omitted name and small Levenshtein differences", () => {
    expect(
      isAcceptableAccountName("Ada Nwosu", "Ada Nkem Nwosu"),
    ).toBe(true);
    expect(
      isAcceptableAccountName("Chinedo Nwosu", "Chinedu Nwosu"),
    ).toBe(true);
    expect(NameMatcher.compare("Ada Nwosu", "Ada Nkem Nwosu")).toEqual({
      score: 90,
      match: "high",
    });
  });

  it("rejects unrelated and weakly matching payout names", () => {
    expect(
      isAcceptableAccountName("Ada Nwosu", "John Bello"),
    ).toBe(false);
    expect(
      isAcceptableAccountName("Ada Nwosu", "Ada Bello"),
    ).toBe(false);
    expect(
      isAcceptableAccountName("Ada Nwosu", "Ada Nkem Chiamaka Nwosu"),
    ).toBe(false);
    expect(isAcceptableAccountName("Ada", "Ada Nwosu")).toBe(false);
  });

  it("serializes only the explicit public signup fields", () => {
    const response = toPublicUserResponse({
      id: "user-1",
      email: "user@example.com",
      firstName: "Ada",
      lastName: "Nwosu",
      bvnNumber: "sensitive-bvn",
      hashedPin: "sensitive-pin-hash",
      telegramId: "42",
      chatId: "42",
    } as never);

    expect(response).toEqual({
      id: "user-1",
      email: "user@example.com",
      firstName: "Ada",
      lastName: "Nwosu",
    });
    expect(JSON.stringify(response)).not.toContain("sensitive");
  });
});
