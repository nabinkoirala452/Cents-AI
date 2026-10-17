import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Check,
  FileText,
  LayoutDashboard,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { Badge, Button, Logo, Title } from "../components/ui"

export type View = "landing" | "login" | "signup" | "register" | "app"

export default function LandingPage({ navigate }: { navigate: (view: View) => void }) {
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })

  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <Logo />
        <nav className="marketing-nav">
          <Button variant="ghost" onClick={() => scrollTo("product")}>
            Product
          </Button>
          <Button variant="ghost" onClick={() => scrollTo("how-it-works")}>
            How it works
          </Button>
          <Button variant="ghost" onClick={() => scrollTo("security")}>
            Security
          </Button>
        </nav>
        <div className="marketing-actions">
          <Button variant="ghost" onClick={() => navigate("login")}>
            Log in
          </Button>
          <Button variant="primary" onClick={() => navigate("signup")}>
            Start free
          </Button>
        </div>
      </header>

      <main className="marketing-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <Sparkles size={14} />
              Finance intelligence for service agencies
            </div>
            <Title className="hero-title">
              Know where your cash is going—
              <span>before it gets there.</span>
            </Title>
            <p>
              CentsAI turns invoices, obligations, project costs, and cash-flow
              forecasts into clear, explainable actions for growing agencies.
            </p>
            <div className="hero-actions">
              <Button
                variant="primary"
                className="marketing-primary"
                onClick={() => navigate("signup")}
              >
                Create your free account <ArrowRight size={16} />
              </Button>
              <Button
                className="marketing-secondary"
                onClick={() => navigate("app")}
              >
                Explore the demo
              </Button>
            </div>
            <div className="hero-proof">
              <span>
                <Check size={13} /> No credit card
              </span>
              <span>
                <Check size={13} /> Demonstration data
              </span>
              <span>
                <Check size={13} /> Setup in minutes
              </span>
            </div>
          </div>

          <div className="hero-product" aria-label="CentsAI dashboard preview">
            <div className="preview-window">
              <div className="preview-topbar">
                <Logo compact />
                <div className="preview-search">
                  <Search size={12} /> Search your finances
                </div>
                <div className="preview-avatar">AK</div>
              </div>
              <div className="preview-body">
                <div className="preview-sidebar">
                  {[LayoutDashboard, TrendingUp, FileText, Bot].map(
                    (Icon, index) => (
                      <div
                        className={index === 0 ? "preview-nav-active" : ""}
                        key={index}
                      >
                        <Icon size={14} />
                        <span>
                          {
                            ["Overview", "Cash flow", "Invoices", "Copilot"][
                              index
                            ]
                          }
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <div className="preview-content">
                  <div className="preview-welcome">
                    <div>
                      <small>GOOD MORNING, ALEX</small>
                      <strong>Your finances, clearly explained.</strong>
                    </div>
                    <Badge tone="amber">Watch payroll</Badge>
                  </div>
                  <div className="preview-metrics">
                    <div>
                      <span>Available cash</span>
                      <strong>$81,250</strong>
                      <small>Verified records</small>
                    </div>
                    <div>
                      <span>90-day expected</span>
                      <strong>$65,642</strong>
                      <small>Expected ending cash</small>
                    </div>
                    <div>
                      <span>Outstanding</span>
                      <strong>$39,570</strong>
                      <small>2 overdue invoices</small>
                    </div>
                  </div>
                  <div className="preview-grid">
                    <div className="preview-chart">
                      <div>
                        <strong>Cash position</strong>
                        <small>Next 90 days</small>
                      </div>
                      <svg
                        viewBox="0 0 500 150"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          className="preview-area"
                          d="M0,62 C65,42 90,71 145,53 C205,34 235,75 285,63 C340,51 365,102 410,91 C455,80 470,93 500,74 L500,150 L0,150 Z"
                        />
                        <path
                          className="preview-line"
                          d="M0,62 C65,42 90,71 145,53 C205,34 235,75 285,63 C340,51 365,102 410,91 C455,80 470,93 500,74"
                        />
                      </svg>
                      <div className="preview-chart-axis">
                        <span>Today</span>
                        <span>21 Nov</span>
                        <span>15 Jan</span>
                      </div>
                    </div>
                    <div className="preview-brief">
                      <div className="preview-brief-title">
                        <Sparkles size={13} /> Today’s briefing
                      </div>
                      <div>
                        <span className="brief-dot alert" />
                        <p>
                          <strong>Collect $10,610</strong>
                          <small>Two invoices are overdue</small>
                        </p>
                      </div>
                      <div>
                        <span className="brief-dot" />
                        <p>
                          <strong>Protect payroll</strong>
                          <small>Due in five days</small>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-float hero-float-risk">
              <div className="float-icon">
                <AlertTriangle size={15} />
              </div>
              <span>
                <small>Cash-flow risk</small>
                <strong>21 November</strong>
              </span>
            </div>
            <div className="hero-float hero-float-ai">
              <div className="float-icon green">
                <Sparkles size={15} />
              </div>
              <span>
                <small>CentsAI found</small>
                <strong>3 actions today</strong>
              </span>
            </div>
          </div>
        </section>

        <section className="trust-strip">
          <span>Built for the way agencies operate</span>
          <div>
            <strong>SOFTWARE STUDIOS</strong>
            <strong>IT CONSULTANCIES</strong>
            <strong>CREATIVE AGENCIES</strong>
            <strong>MARKETING TEAMS</strong>
          </div>
        </section>

        <section className="marketing-section" id="product">
          <div className="section-heading">
            <span>ONE FINANCIAL OPERATING SYSTEM</span>
            <Title>Clarity across every moving part.</Title>
            <p>
              Stop stitching together spreadsheets to understand what happened.
              See what matters now—and what is likely to happen next.
            </p>
          </div>
          <div className="feature-grid">
            {[
              [
                TrendingUp,
                "Cash flow, forward",
                "Forecast expected, optimistic, and conservative cash positions with every assumption made visible.",
              ],
              [
                ReceiptText,
                "Collect with confidence",
                "Prioritize overdue invoices, review reminders, and verify payment status before updating your ledger.",
              ],
              [
                BriefcaseBusiness,
                "Know your true margins",
                "Connect revenue, people, contractors, and tools to see which client work is actually contributing.",
              ],
              [
                Bot,
                "An analyst that explains",
                "Ask practical questions and get recommendations grounded in your agency’s displayed records.",
              ],
            ].map(([Icon, title, copy], index) => {
              const FeatureIcon = Icon as LucideIcon
              return (
                <article
                  className={`feature-card feature-card-${index + 1}`}
                  key={title as string}
                >
                  <div className="feature-icon">
                    <FeatureIcon size={19} />
                  </div>
                  <Title level={2}>{title as string}</Title>
                  <p>{copy as string}</p>
                  <button className="feature-link" onClick={() => navigate("app")}>
                    See it in the demo <ArrowRight size={13} />
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="how-copy">
            <span className="section-kicker">FROM RECORDS TO ACTION</span>
            <Title>Every answer shows its working.</Title>
            <p>
              CentsAI keeps recorded figures, modelled projections, and
              uncertain receipts clearly separated—so you can act without
              mistaking a forecast for cash in the bank.
            </p>
            <div className="how-list">
              {[
                [
                  "01",
                  "Bring your records together",
                  "Invoices, expenses, projects, payroll, and obligations.",
                ],
                [
                  "02",
                  "Review the assumptions",
                  "See exactly what each forecast includes and excludes.",
                ],
                [
                  "03",
                  "Approve sensitive actions",
                  "Keep payments and financial changes human-controlled.",
                ],
              ].map(([number, title, copy]) => (
                <div key={number}>
                  <span>{number}</span>
                  <p>
                    <strong>{title}</strong>
                    <small>{copy}</small>
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="how-card">
            <div className="how-card-top">
              <span>
                <Sparkles size={14} /> CentsAI analysis
              </span>
              <Badge tone="green">Based on workspace records</Badge>
            </div>
            <p>Can we afford to hire another developer?</p>
            <div className="how-answer">
              <strong>Not comfortably in the conservative scenario.</strong>
              <span>
                Hiring now would reduce monthly headroom by $5,600. Cash could
                fall below your safety threshold if Acme pays late.
              </span>
            </div>
            <div className="how-stats">
              <div>
                <span>Lowest balance</span>
                <strong>$5,634</strong>
              </div>
              <div>
                <span>Threshold breaches</span>
                <strong>7 days</strong>
              </div>
            </div>
            <Button variant="primary" onClick={() => navigate("app")}>
              View full calculation
            </Button>
          </div>
        </section>

        <section className="security-section" id="security">
          <div>
            <ShieldCheck size={25} />
            <Title level={2}>Safe action, by design.</Title>
          </div>
          <p>
            CentsAI never treats a submitted request as proof of payment.
            Sensitive workflows stay approval-based, credentials stay on the
            backend, and every status change leaves an audit trail.
          </p>
          <Button onClick={() => navigate("register")}>
            Register your agency <ArrowRight size={14} />
          </Button>
        </section>

        <section className="final-cta">
          <span>FINANCIAL CLARITY STARTS HERE</span>
          <Title>Run your agency with fewer surprises.</Title>
          <p>
            Understand your cash. Protect your margins. Make the next decision
            with confidence.
          </p>
          <div>
            <Button
              variant="primary"
              className="marketing-primary"
              onClick={() => navigate("signup")}
            >
              Start free <ArrowRight size={15} />
            </Button>
            <Button onClick={() => navigate("login")}>Log in</Button>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <Logo compact />
        <p>Financial clarity for small service agencies.</p>
        <span>© {new Date().getFullYear()} CentsAI · Demonstration product</span>
      </footer>
    </div>
  )
}
