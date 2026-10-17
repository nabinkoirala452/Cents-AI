import { useEffect, useState } from "react"
import {
  BriefcaseBusiness,
  Bot,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react"

export type PageId =
  | "dashboard" | "briefing" | "transactions" | "invoices" | "cash-flow" | "expenses" | "payroll"
  | "loans" | "projects" | "simulator" | "financing" | "copilot" | "approvals" | "settings"

export type PublicView = "landing" | "login" | "signup" | "register"

export const PAGES: Record<PageId, { label: string; icon: LucideIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  briefing: { label: "AI Finance Briefing", icon: Sparkles },
  transactions: { label: "Transactions", icon: ReceiptText },
  invoices: { label: "Invoices & Payments", icon: FileText },
  "cash-flow": { label: "Cash Flow", icon: TrendingUp },
  expenses: { label: "Expenses & Subscriptions", icon: CreditCard },
  payroll: { label: "Payroll & Contractors", icon: Users },
  loans: { label: "Loans & EMIs", icon: Landmark },
  projects: { label: "Projects & Profitability", icon: BriefcaseBusiness },
  simulator: { label: "Scenario Simulator", icon: SlidersHorizontal },
  financing: { label: "Financing Assistant", icon: CircleDollarSign },
  copilot: { label: "AI Copilot", icon: Bot },
  approvals: { label: "Approvals & Audit", icon: FileCheck2 },
  settings: { label: "Settings", icon: Settings },
}

export const NAV_GROUPS: { label: string; items: PageId[] }[] = [
  { label: "OVERVIEW", items: ["dashboard", "briefing"] },
  { label: "FINANCES", items: ["transactions", "invoices", "cash-flow", "expenses", "payroll", "loans"] },
  { label: "BUSINESS INTELLIGENCE", items: ["projects", "simulator", "financing"] },
  { label: "WORKSPACE", items: ["copilot", "approvals", "settings"] },
]

export type Route =
  | { view: PublicView }
  | { view: "app"; page: PageId; params: URLSearchParams }

const parse = (): Route => {
  const hash = window.location.hash.replace(/^#\/?/, "")
  const [path, query = ""] = hash.split("?")
  const parts = path.split("/").filter(Boolean)
  if (parts[0] === "app") {
    const page = (parts[1] ?? "dashboard") as PageId
    return { view: "app", page: page in PAGES ? page : "dashboard", params: new URLSearchParams(query) }
  }
  if (parts[0] === "login" || parts[0] === "signup" || parts[0] === "register") return { view: parts[0] }
  return { view: "landing" }
}

/** Navigate to an app page ("invoices?tab=Overdue") or a public view ("/login"). */
export const go = (to: string) => {
  const target = to.startsWith("/") ? `#${to}` : `#/app/${to}`
  if (window.location.hash !== target) window.location.hash = target
}

export const useRoute = () => {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const onChange = () => {
      setRoute(parse())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return route
}

/** Query parameters of the current app route, e.g. `invoices?id=INV-1042`. */
export const routeParams = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "")
