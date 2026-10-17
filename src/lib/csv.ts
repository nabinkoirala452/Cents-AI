import { addDays } from "./dates"

/** RFC 4180-style CSV parser: handles quoted fields, escaped quotes, and CRLF. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(field.trim())
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(field.trim())
      if (row.some((cell) => cell !== "")) rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  row.push(field.trim())
  if (row.some((cell) => cell !== "")) rows.push(row)
  return rows
}

const escape = (value: unknown) => {
  const s = value == null ? "" : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: (string | number | undefined)[][]) => rows.map((r) => r.map(escape).join(",")).join("\n")

export const download = (filename: string, content: string, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Sample bank-style export dated relative to today: includes a DD/MM/YYYY date, a quoted amount, a duplicate of a seeded LinkedIn charge, and one invalid row. */
export const sampleCsv = (today: string) => {
  const day = (n: number) => addDays(today, -n)
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  return `date,description,amount,type,party,category
${day(9)},Domain renewal,"1,450",Expense,GoDaddy,Software
${day(7)},Workshop fee,25000,Income,Spring & Co.,Other income
${dmy(day(5))},Team lunch,3200,Expense,Swiggy,
${day(4)},Stock photos,1800,Expense,Shutterstock,Marketing
${day(22)},LinkedIn campaign,12000,Expense,LinkedIn,Marketing
${day(3)},Refund,abc,Income,Unknown,
`
}
