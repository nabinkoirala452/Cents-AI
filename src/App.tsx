import { Component, useEffect, useState } from "react"
import { Header, Sidebar, Toast } from "./components/layout"
import { go, useRoute, type PageId } from "./lib/router"
import { StoreProvider } from "./lib/store"
import ApprovalsPage from "./pages/Approvals"
import AuthPage from "./pages/Auth"
import BriefingPage from "./pages/Briefing"
import CashFlowPage from "./pages/CashFlow"
import CopilotPage from "./pages/Copilot"
import Dashboard from "./pages/Dashboard"
import ExpensesPage from "./pages/Expenses"
import FinancingPage from "./pages/Financing"
import InvoicesPage from "./pages/Invoices"
import LandingPage, { type View } from "./pages/Landing"
import LoansPage from "./pages/Loans"
import PayrollPage from "./pages/Payroll"
import ProjectsPage from "./pages/Projects"
import SettingsPage from "./pages/Settings"
import SimulatorPage from "./pages/Simulator"
import TransactionsPage from "./pages/Transactions"

const PAGE_COMPONENTS: Record<PageId, () => React.ReactElement> = {
  dashboard: Dashboard,
  briefing: BriefingPage,
  transactions: TransactionsPage,
  invoices: InvoicesPage,
  "cash-flow": CashFlowPage,
  expenses: ExpensesPage,
  payroll: PayrollPage,
  loans: LoansPage,
  projects: ProjectsPage,
  simulator: SimulatorPage,
  financing: FinancingPage,
  copilot: CopilotPage,
  approvals: ApprovalsPage,
  settings: SettingsPage,
}

const THEME_KEY = "centsai.theme"

/** Keeps one broken page from taking down the whole workspace. */
class PageBoundary extends Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="empty">
          <strong>This page hit an error.</strong>
          <p>{this.state.error.message}</p>
          <button className="button button-secondary" onClick={() => this.setState({ error: undefined })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}

function AppShell({ page, params }: { page: PageId; params: URLSearchParams }) {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark"
    } catch {
      return false
    }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light")
    } catch {
      /* ignore */
    }
  }, [dark])
  const Page = PAGE_COMPONENTS[page]
  return (
    <div className={dark ? "app dark" : "app"}>
      <Sidebar page={page} open={sidebarOpen} close={() => setSidebarOpen(false)} signOut={() => go("/")} />
      <div className="main-shell">
        <Header page={page} dark={dark} setDark={setDark} menu={() => setSidebarOpen(true)} />
        <main key={page + params.toString()}>
          <PageBoundary>
            <Page />
          </PageBoundary>
        </main>
      </div>
      <Toast />
    </div>
  )
}

function Router() {
  const route = useRoute()
  const navigate = (view: View) => go(view === "app" ? "dashboard" : view === "landing" ? "/" : `/${view}`)
  if (route.view === "landing") return <LandingPage navigate={navigate} />
  if (route.view !== "app") return <AuthPage key={route.view} mode={route.view} navigate={navigate} />
  return <AppShell page={route.page} params={route.params} />
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  )
}
