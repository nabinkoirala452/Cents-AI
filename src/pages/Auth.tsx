import { useState } from "react"
import { ArrowLeft, ArrowRight, Building2, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react"
import { Button, Input, Logo, Select, Title } from "../components/ui"
import { useStore } from "../lib/store"
import type { View } from "./Landing"

export default function AuthPage({
  mode,
  navigate,
}: {
  mode: "login" | "signup" | "register"
  navigate: (view: View) => void
}) {
  const [submitted, setSubmitted] = useState(false)
  const copy = {
    login: {
      eyebrow: "WELCOME BACK",
      title: "Log in to your workspace",
      description: "Continue to your agency’s financial command center.",
      action: "Log in securely",
    },
    signup: {
      eyebrow: "CREATE YOUR ACCOUNT",
      title: "Start with financial clarity",
      description: "Create your personal account, then set up your agency.",
      action: "Continue to agency setup",
    },
    register: {
      eyebrow: "REGISTER YOUR AGENCY",
      title: "Tell us about your workspace",
      description: "We’ll tailor your demonstration workspace to your agency.",
      action: "Create agency workspace",
    },
  }[mode]

  const { update } = useStore()

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? "").trim()
    if (mode === "signup") {
      const name = `${value("firstName")} ${value("lastName")}`.trim()
      update((d) => {
        d.settings.ownerName = name
        d.settings.ownerEmail = value("email")
        const owner = d.settings.team.find((m) => m.role === "Owner")
        if (owner) Object.assign(owner, { name, email: value("email") })
      })
    }
    if (mode === "register") {
      update((d) => {
        d.settings.agencyName = value("agencyName")
        d.settings.agencyType = value("agencyType")
        d.settings.teamSize = value("teamSize")
      })
    }
    setSubmitted(true)
    window.setTimeout(
      () => navigate(mode === "signup" ? "register" : "app"),
      500,
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <Button
          variant="ghost"
          className="auth-back"
          onClick={() => navigate("landing")}
        >
          <ArrowLeft size={14} /> Back to home
        </Button>
        <Logo />
        <div className="auth-promise">
          <span className="section-kicker">FINANCE, MADE DECIDABLE</span>
          <Title>Understand today. Prepare for tomorrow.</Title>
          <p>
            One calm place to follow cash, protect payroll, collect invoices,
            and understand project margins.
          </p>
          <div className="auth-quote">
            <Sparkles size={18} />
            <p>
              “Your conservative forecast shows limited cash headroom if Acme
              pays late.”
            </p>
            <span>CentsAI Finance Briefing</span>
          </div>
        </div>
        <div className="auth-panel-foot">
          <ShieldCheck size={15} />
          Demonstration environment · No live bank connection
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-eyebrow">{copy.eyebrow}</span>
          <Title>{copy.title}</Title>
          <p className="auth-description">{copy.description}</p>

          {mode === "login" && (
            <>
              <label>
                Work email
                <div className="auth-input">
                  <Mail size={16} />
                  <Input
                    type="email"
                    placeholder="alex@meridian.example"
                    defaultValue="alex@meridian.example"
                    required
                  />
                </div>
              </label>
              <label>
                <span className="label-row">
                  Password
                  <Button variant="ghost" type="button">
                    Forgot password?
                  </Button>
                </span>
                <div className="auth-input">
                  <LockKeyhole size={16} />
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    defaultValue="demopassword"
                    required
                  />
                </div>
              </label>
            </>
          )}

          {mode === "signup" && (
            <>
              <div className="auth-form-row">
                <label>
                  First name
                  <Input name="firstName" placeholder="Alex" required />
                </label>
                <label>
                  Last name
                  <Input name="lastName" placeholder="Kumar" required />
                </label>
              </div>
              <label>
                Work email
                <div className="auth-input">
                  <Mail size={16} />
                  <Input
                    name="email"
                    type="email"
                    placeholder="you@youragency.com"
                    required
                  />
                </div>
              </label>
              <label>
                Create password
                <div className="auth-input">
                  <LockKeyhole size={16} />
                  <Input
                    type="password"
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                </div>
              </label>
            </>
          )}

          {mode === "register" && (
            <>
              <label>
                Agency name
                <div className="auth-input">
                  <Building2 size={16} />
                  <Input name="agencyName" placeholder="Meridian Digital Studio" required />
                </div>
              </label>
              <div className="auth-form-row">
                <label>
                  Agency type
                  <Select name="agencyType" defaultValue="Software agency">
                    <option>Software agency</option>
                    <option>IT consultancy</option>
                    <option>Marketing agency</option>
                    <option>Creative studio</option>
                  </Select>
                </label>
                <label>
                  Team size
                  <Select name="teamSize" defaultValue="6–10">
                    <option>2–5</option>
                    <option>6–10</option>
                    <option>11–20</option>
                  </Select>
                </label>
              </div>
              <label>
                Reporting currency
                <Select defaultValue="USD">
                  <option value="USD">USD — US Dollar</option>
                </Select>
              </label>
              <div className="registration-note">
                <ShieldCheck size={16} />
                <span>
                  This creates a local demonstration workspace with sample
                  records. All workspace amounts are in USD. Clients can pay
                  by PayPal or bank transfer.
                </span>
              </div>
            </>
          )}

          <Button
            type="submit"
            variant="primary"
            className="auth-submit"
            disabled={submitted}
          >
            {submitted ? (
              <>
                <span className="auth-spinner" /> Setting up…
              </>
            ) : (
              <>
                {copy.action} <ArrowRight size={15} />
              </>
            )}
          </Button>

          {mode !== "register" && (
            <div className="auth-switch">
              {mode === "login"
                ? "New to CentsAI?"
                : "Already have an account?"}
              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  navigate(mode === "login" ? "signup" : "login")
                }
              >
                {mode === "login" ? "Create an account" : "Log in"}
              </Button>
            </div>
          )}
          {mode === "register" && (
            <div className="auth-switch">
              Not ready yet?
              <Button
                variant="ghost"
                type="button"
                onClick={() => navigate("app")}
              >
                Explore with demo data
              </Button>
            </div>
          )}
          <p className="auth-terms">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </p>
        </form>
      </div>
    </div>
  )
}
