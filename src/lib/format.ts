import type { Currency } from "./types"

export const money = (value: number, currency: Currency = "INR") => {
  const rounded = currency === "INR" ? Math.round(value) : Math.round(value * 100) / 100
  const abs = Math.abs(rounded)
  const body =
    currency === "INR"
      ? `₹${abs.toLocaleString("en-IN")}`
      : `$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
  return rounded < 0 ? `−${body}` : body
}

export const signedMoney = (value: number, currency: Currency = "INR") =>
  value > 0 ? `+${money(value, currency)}` : money(value, currency)

/** Compact INR for chart axes: ₹4.9L, ₹85k. */
export const compactINR = (value: number) => {
  const abs = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`
  if (abs >= 1000) return `${sign}₹${Math.round(abs / 1000)}k`
  return `${sign}₹${Math.round(abs)}`
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
