-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('Owner', 'FinanceManager', 'Viewer');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('INR', 'USD');

-- CreateEnum
CREATE TYPE "Scenario" AS ENUM ('expected', 'optimistic', 'conservative');

-- CreateEnum
CREATE TYPE "ProjectBilling" AS ENUM ('Fixed', 'Milestone', 'Retainer');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('Active', 'Completed');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('Milestone', 'Retainer', 'Project');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('Draft', 'Sent', 'Paid', 'Cancelled');

-- CreateEnum
CREATE TYPE "InvoiceChannel" AS ENUM ('PayPal', 'Bank transfer');

-- CreateEnum
CREATE TYPE "PayPalStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('PayPal', 'Manual');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('Income', 'Expense');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('Recorded', 'Verified', 'Review');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('Manual', 'CSV import', 'Invoice payment', 'PayPal', 'Recurring');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('Active', 'Planned');

-- CreateEnum
CREATE TYPE "ContractorBillStatus" AS ENUM ('Scheduled', 'Pending', 'Paid');

-- CreateEnum
CREATE TYPE "RecurringCategory" AS ENUM ('Software', 'Rent', 'Tax', 'Utilities', 'Marketing');

-- CreateEnum
CREATE TYPE "RecurringKind" AS ENUM ('Subscription', 'Fixed cost');

-- CreateEnum
CREATE TYPE "RecurringCycle" AS ENUM ('Monthly', 'Annual');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('Active', 'Review', 'Cancelled');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('paypal_send_invoice', 'send_reminder', 'record_contractor_payment', 'cancel_subscription');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Rejected', 'Submitted', 'Verified', 'Failed', 'Stale');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('info', 'success', 'warning', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agencyType" TEXT NOT NULL,
    "teamSize" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "seededOn" TEXT NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "workspaceId" TEXT NOT NULL,
    "usdRate" DECIMAL(14,2) NOT NULL,
    "safetyThreshold" DECIMAL(14,2) NOT NULL,
    "defaultHorizon" INTEGER NOT NULL,
    "planningScenario" "Scenario" NOT NULL,
    "managerApprovalLimit" DECIMAL(14,2) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "openingDate" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "notifications" JSONB NOT NULL,
    "readiness" JSONB NOT NULL,
    "dismissedInsights" JSONB NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Client" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "avgDelayDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Project" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "billing" "ProjectBilling" NOT NULL,
    "contractValue" DECIMAL(14,2) NOT NULL,
    "budgetCost" DECIMAL(14,2) NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "timeEntries" JSONB NOT NULL,
    "unassignedHours" DOUBLE PRECISION NOT NULL,
    "retainer" JSONB,
    "plannedBillings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "InvoiceKind" NOT NULL,
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "lineItems" JSONB NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "channel" "InvoiceChannel" NOT NULL,
    "paidDate" TEXT,
    "paypalInvoiceId" TEXT,
    "paypalStatus" "PayPalStatus",
    "paypalPayerUrl" TEXT,
    "paypalSentAt" TIMESTAMP(3),
    "paypalLastCheckedAt" TIMESTAMP(3),
    "reminders" JSONB NOT NULL,
    "expectedDelayOverride" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2),
    "net" DECIMAL(14,2),
    "currency" "Currency" NOT NULL,
    "fxRate" DECIMAL(14,2) NOT NULL,
    "amountINR" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "source" "TransactionSource" NOT NULL,
    "invoiceId" TEXT,
    "paymentEventId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "reviewReason" TEXT,
    "importJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "monthlySalary" DECIMAL(14,2) NOT NULL,
    "payDay" INTEGER NOT NULL,
    "status" "EmployeeStatus" NOT NULL,
    "startDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "ContractorBill" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "projectId" TEXT,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" "ContractorBillStatus" NOT NULL,
    "paidDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorBill_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "RecurringCost" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "category" "RecurringCategory" NOT NULL,
    "kind" "RecurringKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "previousAmount" DECIMAL(14,2),
    "cycle" "RecurringCycle" NOT NULL,
    "nextDate" TEXT NOT NULL,
    "startedOn" TEXT NOT NULL,
    "status" "RecurringStatus" NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCost_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "emiDay" INTEGER NOT NULL,
    "prepaymentFeePct" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "LoanOffer" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "fees" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanOffer_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "SavedScenario" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedScenario_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "title" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountINR" DECIMAL(14,2) NOT NULL,
    "refId" TEXT NOT NULL,
    "preparedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "draft" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "result" TEXT,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "preparedByUserId" TEXT,
    "preparedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "ref" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("providerEventId")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "invalid" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("workspaceId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_clientId_idx" ON "Project"("workspaceId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paypalInvoiceId_key" ON "Invoice"("paypalInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_clientId_idx" ON "Invoice"("workspaceId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_workspaceId_source_externalId_key" ON "PaymentEvent"("workspaceId", "source", "externalId");

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_date_idx" ON "Transaction"("workspaceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_workspaceId_paymentEventId_key" ON "Transaction"("workspaceId", "paymentEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_idempotencyKey_key" ON "Approval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_at_idx" ON "AuditEvent"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_clientId_fkey" FOREIGN KEY ("workspaceId", "clientId") REFERENCES "Client"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_workspaceId_invoiceId_fkey" FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "Invoice"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_paymentEventId_fkey" FOREIGN KEY ("workspaceId", "paymentEventId") REFERENCES "PaymentEvent"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBill" ADD CONSTRAINT "ContractorBill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCost" ADD CONSTRAINT "RecurringCost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanOffer" ADD CONSTRAINT "LoanOffer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedScenario" ADD CONSTRAINT "SavedScenario_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedScenario" ADD CONSTRAINT "SavedScenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
