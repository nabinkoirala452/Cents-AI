import { describe, expect, it } from "vitest"
import { canonicalJson, payloadHash } from "../src/lib/hash"

describe("canonical payload hashing", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 4, a: 5 }] }))
      .toBe('{"a":{"b":3,"y":2},"list":[{"a":5,"z":4}],"z":1}')
  })

  it("hashes logically equivalent objects identically", () => {
    expect(payloadHash({ z: 1, a: { c: true, b: false } }))
      .toBe(payloadHash({ a: { b: false, c: true }, z: 1 }))
  })
})
