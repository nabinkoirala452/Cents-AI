import { createHash } from "node:crypto"

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        sortObjectKeys((value as Record<string, unknown>)[key]),
      ]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortObjectKeys(value))
  if (serialized === undefined) {
    throw new TypeError("Value cannot be represented as canonical JSON")
  }
  return serialized
}

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}
