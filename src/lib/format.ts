import type { Currency } from "./types"

export const money = (value: number, currency: Currency = "USD") => {
  const rounded = Math.round(value * 100) / 100
  const hasCents = Math.abs(rounded - Math.round(rounded)) > Number.EPSILON
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded)
}

export const signedMoney = (value: number, currency: Currency = "USD") =>
  value > 0 ? `+${money(value, currency)}` : money(value, currency)

export const compactMoney = (value: number, currency: Currency = "USD") => {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  const symbol = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currency
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}${symbol}${Math.round(abs / 1_000)}k`
  return `${sign}${symbol}${Math.round(abs)}`
}

export const pct = (value: number, digits = 1) =>
  `${Number.isFinite(value) ? value.toFixed(digits) : "0"}%`

export const changePct = (current: number, previous: number) =>
  previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / previous) * 100

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
