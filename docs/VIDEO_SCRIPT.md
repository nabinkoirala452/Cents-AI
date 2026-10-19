# CentsAI — Demo Video Script (≤ 5 min)

Target length: **about 4:40**. The story: *a cash problem → the AI explains it → the AI prepares an action → people approve → PayPal confirms → everything is in the audit log.*

**How to read this:**
- Text in **[brackets]** is what you do *at that moment*: move the mouse, point or click. Then say the sentence that follows.
- Plain text is what you **say**. Speak slowly; it's fine to pause between lines.
- ⏱ is the time budget for each scene.
- Numbers below are from today's reseed (19 Oct). If you record on another day they can shift a little, so **always read the number on your screen**.

---

## Before you record

**Data:** ✅ already reseeded on 19 Oct. INV-1058 and INV-1059 are Draft, INV-1042 and INV-1048 are overdue, and all PayPal links are real.

**Servers:** API on 8787 and the app on 8443 (hosted). The landing page on **http://localhost:8450** is for Scene 1 only.

**Tabs** (one browser is fine; open each tab fresh and type the URL — don't use *Duplicate tab*):
1. **Tab 1:** http://localhost:8450, the landing page
2. **Tab 2:** http://localhost:8443, signed in as **Alex** (`owner@centsai.demo`)
3. **Tab 3:** http://localhost:8443, signed in as **Neha** (`finance@centsai.demo`)
4. **Incognito window:** used in Scene 6 to pay as the sandbox **buyer**

**Warm up:** in Tab 2, ask the Copilot any question once, so Groq is fast during the take.

**Screen:** zoom 110%, hide the bookmarks bar (**Ctrl+Shift+B**), turn on Focus mode. Record with **Win+Alt+R** or Snipping Tool (**Win+Shift+R**), one clip per scene, and cut the waiting in Clipchamp.

---

## Scene 1 — The problem · ⏱ 0:00–0:25

**Tab 1 (landing page).** Start at the top, completely still.

**[Mouse still on the headline "Know where your cash is going"]**
Small service agencies get paid in big, irregular chunks. A large project invoice can easily pay three weeks late.

**[Scroll down slowly]**
But payroll, contractors, software and loan payments are due on fixed dates. Bookkeeping tools tell you what happened last month. They don't tell you whether you can make payroll next month, or what to do about it.

**[Scroll back to the top, mouse on the CentsAI logo]**
This is CentsAI, an AI finance copilot for agencies of two to twenty people.

---

## Scene 2 — The dashboard · ⏱ 0:25–1:00

**Tab 2 (Alex), Dashboard, scrolled to the top.**

**[Mouse on "Good evening, Alex"]**
I'm Alex, the owner of Meridian Digital Studio, a software agency.

**[Point at the first card, Available Cash $81,250]**
Right now we have about eighty-one thousand dollars in the bank.

**[Move to the last card, Projected Cash · 90 days, and point at "Conservative low $10,568" under it]**
But CentsAI looks ahead ninety days, and in the worst case our cash drops to about ten and a half thousand.

**[Scroll down a little until the chart and "Today's Finance Briefing" are on screen. Run the mouse along the dashed orange line to the red dot near 28 Nov]**
This dashed line is the conservative scenario. And this red dot is where cash falls below our twelve-and-a-half-thousand-dollar safety line.

**[Point at the right side, briefing item 1, "Follow up on overdue invoices $10,610"]**
The briefing tells me why: two clients are overdue, more than ten thousand dollars in total.

**[Point at item 3, "Protect upcoming payroll $32,550"]**
And payroll for six people, thirty-two and a half thousand, is due on the twenty-third.

**[Scroll down to "Invoices Requiring Attention", point at the Acme row (INV-1042, 5 days overdue), then the PixelCraft row (INV-1048, 2 days overdue)]**
Here are the two overdue invoices: Acme and PixelCraft.

**[Mouse on the small "Grounded in your records" label next to the briefing, or anywhere on the cards]**
Every number on this page comes from a deterministic finance engine that runs on our real records, not from the AI guessing.

> Skip the separate Briefing page; the dashboard already shows everything for this scene.

---

## Scene 3 — Cash-flow scenarios · ⏱ 1:00–1:25

**Click Cash Flow in the sidebar.**

**[Mouse on the scenario switch, click Expected]**
Here's the full ninety-day forecast. In the expected case, where clients pay at their usual speed, we're fine.

**[Click Conservative, then point at the lowest point on the chart and the threshold line]**
But if slow clients pay a month late, cash dips below the safety line at the end of November.

**[Scroll to the list of drivers and uncertain receipts under the chart, and run the mouse down it]**
And it shows me exactly why: these are the big payments before that low point, and these are the receipts that aren't certain yet.

---

## Scene 4 — Ask the AI agent · ⏱ 1:25–2:05

**Click Copilot.**

**[Point at the "AI agent · Groq" badge]**
Now I'll just ask the AI.

**[Click the input box and type: `Can we cover payroll if Acme pays 30 days late?` Then press Enter]**
Can we cover payroll if Acme pays thirty days late?

**[While it thinks, mouse on the loading answer]**
The AI agent doesn't do the math itself. It picks the right tool from our finance engine, here the late-payment simulator, and runs it on our real data.

**[When the answer appears, point at the headline]**
It gives a straight answer.

**[Point at the figure cards: cash after payroll and the lowest balance]**
With the exact cash left after payroll and the lowest balance.

**[Point at the tool trace showing `late_payment_impact`]**
I can see which tool it used.

**[Point at the grounding / verified amounts note]**
And this matters most in finance: every dollar amount the AI writes is checked against the tool's output. If it invents or even rounds a number, CentsAI flags it. The AI can't slip in a made-up number.

---

## Scene 5 — The agent prepares, people approve · ⏱ 2:05–3:15

### Part A: switch to Tab 3 (Neha, Finance Manager)

**[Mouse on Neha's name at the bottom of the sidebar]**
Now I'm Neha, the finance manager.

**[Copilot → click Run daily check]**
Every morning the agent runs a daily check.

**[While it runs or when it finishes, point at the PayPal status lines and "reminder prepared for INV-1048"]**
It asks PayPal for the live status of every overdue invoice. PixelCraft still hasn't paid, so the agent wrote a polite reminder.

**[Go to Invoices → open INV-1058, Greyspace $6,000, Draft → click Send via PayPal → request approval]**
I also want to send our next six-thousand-dollar invoice to Greyspace through PayPal.

**[Go to Approvals, point at the reminder card marked "CentsAI agent (for Neha Shah)"]**
But nothing has been sent. The agent can only prepare an approval.

**[Point at the disabled or blocked Approve button on both cards]**
And I can't approve either of these myself. CentsAI enforces maker-checker: whoever prepares an action, including the AI on their behalf, can't approve it.

### Part B: switch to Tab 2 (Alex, Owner) → Approvals

**[Open the reminder card, point at the AI-written message]**
Back as Alex, the owner. I can read exactly what the AI wrote before it goes out.

**[Click Approve]**
Looks good. Approve.

**[Open the INV-1058 card, point at the steps list]**
Now the invoice. These are the exact steps it will take.

**[Click Approve and wait for "Verified · PayPal status SENT · INV2-…". Point at the INV2 ID]**
Approve. CentsAI creates and sends a real invoice in PayPal Sandbox, then checks with PayPal that it was really sent. Verified, and this is PayPal's own invoice ID.

**[Mouse anywhere on the approval card]**
Finance managers also have an approval limit, six thousand dollars here. Anything bigger can only be approved by the owner.

---

## Scene 6 — Real sandbox payment · ⏱ 3:15–4:00

**[Tab 2 → Invoices → INV-1058 → point at the PayPal payer link, then copy it]**
Now the client pays.

**[Switch to the incognito window, paste the link, sign in as the sandbox buyer, click Pay and finish. Cut the wait in editing]**
This is PayPal's own payment page in the sandbox, and the payment goes through.

**[Back to Tab 2 → INV-1058 → mouse on Verify payment status]**
CentsAI doesn't trust a button click or a message saying "paid".

**[Click Verify payment status, then point at the status changing to Paid]**
When I verify, the server asks PayPal directly, checks the amount and currency, and only then records the payment. Paid.

**[Go to Transactions and point at the new PayPal income row at the top]**
The income is now in the ledger.

**[Go to Dashboard and point at Available Cash, now higher]**
And the cash and forecast update straight away.

---

## Scene 7 — Audit trail · ⏱ 4:00–4:25

**[Approvals → scroll to the audit log, run the mouse down the rows: the daily check, the approvals, the PayPal calls, "Payment verified"]**
Everything we just did is in the audit log: the agent's daily check, each approval and who made it, every PayPal API call with PayPal's own debug ID, and the verified payment.

**[Mouse on any row]**
The log is append-only at the database level, so nobody can edit history.

**[Click Export audit CSV]**
And it exports to CSV for an accountant or auditor.

---

## Scene 8 — Close · ⏱ 4:25–4:40

**[Go back to the Dashboard, mouse still]**
CentsAI: the AI explains and prepares, deterministic code does the math, a person approves, and PayPal confirms, with every step audited.

**[Stay still for 2 seconds]**
Cash-flow clarity for small agencies, without handing an AI the keys to your bank account. Thank you.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| The Copilot is slow, or says "Rule-based answer" | Wait 60 s and ask again, or keep it and say: *"if the AI provider is down, CentsAI falls back to its rule-based engine."* |
| A save takes 5–7 s | Normal (remote database). Keep recording and cut it later |
| The daily check prepares nothing | A reminder for that invoice is already open. Reject it in Approvals and run the check again |
| The sandbox payment fails | Pay INV-1048 ($3,780) instead, or add funds to the sandbox buyer at developer.paypal.com → Sandbox accounts |
| You need to redo the takes from scratch | Ask me to reseed. It puts INV-1058 back to Draft |
| You go over 5:00 | Shorten Scene 3 to one sentence and drop the approval-limit line in Scene 5 |

## After recording (for the execution evidence)

1. Keep the **audit CSV** from Scene 7.
2. Take 2–3 screenshots: sandbox.paypal.com signed in as the **business** account → Invoices, showing INV-1058 Paid.
3. Upload the video (YouTube **unlisted** or Google Drive link) and add the link to the submission.
4. Send me the CSV and screenshots and I'll put together `docs/evidence/`.
