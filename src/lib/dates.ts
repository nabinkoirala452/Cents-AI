const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const pad = (n: number) => String(n).padStart(2, "0")

export const toISO = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const parseISO = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(y, m - 1, d)
}

export const todayISO = () => toISO(new Date())

export const nowStamp = () => new Date().toISOString()

export const addDays = (iso: string, days: number) => {
  const date = parseISO(iso)
  date.setDate(date.getDate() + days)
  return toISO(date)
}

export const diffDays = (a: string, b: string) =>
  Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000)

export const monthKey = (iso: string) => iso.slice(0, 7)

/** ISO date for a given day of the month `offset` months from `iso`, clamped to month length. */
export const dayInMonth = (iso: string, offset: number, day: number) => {
  const base = parseISO(iso)
  const target = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return toISO(target)
}

export const addMonths = (iso: string, months: number) =>
  dayInMonth(iso, months, parseISO(iso).getDate())

export const fmtDay = (iso: string) => {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export const fmtDate = (iso: string) => {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const fmtLong = (iso: string) => {
  const d = parseISO(iso)
  return `${d.getDate()} ${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const fmtMonth = (iso: string) => {
  const d = parseISO(iso)
  return `${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export const fmtStamp = (stamp: string) => {
  const d = new Date(stamp)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = toISO(d)
  const today = todayISO()
  if (day === today) return `Today, ${time}`
  if (day === addDays(today, -1)) return `Yesterday, ${time}`
  return `${fmtDate(day)}, ${time}`
}

export const relativeDue = (dueISO: string, today: string) => {
  const days = diffDays(dueISO, today)
  if (days === 0) return "Due today"
  if (days > 0) return `Due in ${days} day${days === 1 ? "" : "s"}`
  return `${-days} day${days === -1 ? "" : "s"} overdue`
}

export const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

/** Parses common CSV date formats into ISO. Returns null when the value is not a date. */
export const parseLooseDate = (value: string): string | null => {
  const v = value.trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return valid(+m[3], +m[2], +m[1])
  m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/)
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase())
    if (month >= 0) return valid(+m[3], month + 1, +m[1])
  }
  return null
}

const valid = (y: number, m: number, d: number) => {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? toISO(date)
    : null
}
