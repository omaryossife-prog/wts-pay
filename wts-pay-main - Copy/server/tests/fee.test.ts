import { describe, it, expect } from "vitest";
import { calculateTransferFee, calculateTotalDebit } from "../src/services/fee.service.js";

// All examples from the spec: fee = CEILING(amount / 1000)
const CASES: [number, number, number][] = [
  [50, 1, 51],
  [500, 1, 501],
  [1000, 1, 1001],
  [1001, 2, 1003],
  [1050, 2, 1052],
  [1999, 2, 2001],
  [2000, 2, 2002],
  [2500, 3, 2503],
  [7800, 8, 7808],
  [8000, 8, 8008],
  [8001, 9, 8010],
  [10000, 10, 10010],
];

describe("fee.service - calculateTransferFee", () => {
  it.each(CASES)("amount %i -> fee %i, sender pays %i", (amount, fee, total) => {
    expect(calculateTransferFee(amount)).toBe(fee);
    expect(calculateTotalDebit(amount)).toBe(total);
  });

  it("rejects zero, negative and non-integer amounts", () => {
    expect(() => calculateTransferFee(0)).toThrow();
    expect(() => calculateTransferFee(-5)).toThrow();
    expect(() => calculateTransferFee(10.5)).toThrow();
  });
});
