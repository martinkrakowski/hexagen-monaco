# Krakowski Portal

This document outlines the architecture for the Krakowski Portal project. The system is split into several bounded contexts that work together to manage user identity, customer onboarding, billing, and project delivery.

## Apps

The portal ships as three deployable apps:

```yaml
apps:
  - name: web-portal
    framework: Next.js
    version: "15"
    role: customer-facing
    deployment: vercel
    auth: clerk
  - name: admin-console
    framework: Next.js
    version: "15"
    role: internal-admin
    deployment: vercel
  - name: webhook-worker
    framework: Node
    version: "22"
    role: background
    deployment: fly.io
```

---

## Identity & Access

The core of our user management.

**Responsibility**: User identity and access management
**Type**: core
**App**: web-portal

### Aggregates

- **User** (Root)
  Fields:
  - `id` (key)
  - `username`
  - `email`
- **OnboardingState**
  Parent: Customer

### Value Objects

- **EmailAddress** (immutable)
  Rules:
  - Valid RFC 5322 format

### Use Cases

- RegisterUser (System actor)
- AuthenticateUser (User actor)

---

## Customer Onboarding

Handles the onboarding pipeline for new customers.

**Responsibility**: Customer onboarding process
**Type**: core
**App**: web-portal

### Aggregates

- **Customer** (Root)
  Fields:
  - `id` (key)
  - `name`
  - `status`

### Value Objects

- **OnboardingStatus** (enum)
  Values: pending, in-progress, completed, rejected

### Use Cases

- StartOnboarding (System actor)
- CompleteOnboarding (Admin actor)

---

## Invoicing & Billing

**Responsibility**: Invoicing and billing management
**Type**: core
**App**: web-portal

### Aggregates

- **Invoice** (Root)
  Fields:
  - `id` (key)
  - `amount`
  - `status`

### Value Objects

- **Money**
  Rules:
  - Non-negative
- **InvoiceStatus** (enum)
  Values: draft, sent, paid, void

### Events Published

- InvoicePaid

### Use Cases

- CreateInvoice (Admin actor)
- MarkInvoicePaid (System actor)

---

## Payment Processing

**Responsibility**: Payment processing via Stripe
**Type**: core
**App**: webhook-worker

### Aggregates

- **Payment** (Root)
  Fields:
  - `id` (key)
  - `amount`
  - `provider_ref`

### Events Published

- PaymentReceived

### Use Cases

- RecordPayment (System actor)

---

## Notification Delivery

**Responsibility**: Notification delivery via email and in-app
**Type**: supporting
**App**: webhook-worker

### Use Cases

- SendNotification (System actor)

---

## Project Delivery

**Responsibility**: Project lifecycle management
**Type**: core
**App**: web-portal

### Aggregates

- **Project** (Root)
  Fields:
  - `id` (key)
  - `name`
  - `phase`

### Value Objects

- **ProjectPhase** (enum)
  Values: planning, active, completed, archived

### Use Cases

- CreateProject (Admin actor)
- ArchiveProject (Admin actor)

---

## Reporting & Analytics

**Responsibility**: Reporting and analytics
**Type**: generic
**App**: admin-console

### Use Cases

- GenerateMonthlyReport (Admin actor)

---

## Context Mappings

Here is how the systems talk to each other:

- Stripe -> PaymentProcessing (Pattern: OHS_ACL, Mechanism: webhook)
- PaymentProcessing -> InvoicingBilling (Pattern: OH, Mechanism: event)
- InvoicingBilling -> NotificationDelivery (Pattern: ACL, Mechanism: event)
- CustomerOnboarding -> IdentityAccess (Pattern: OH, Mechanism: api)
- IdentityAccess -> CustomerOnboarding (Pattern: OH, Mechanism: api)
- ProjectDelivery -> NotificationDelivery (Pattern: ACL, Mechanism: event)
- InvoicingBilling -> ProjectDelivery (Pattern: ACL, Mechanism: event)
- NotificationDelivery -> IdentityAccess (Pattern: OH, Mechanism: api)
- ReportingAnalytics -> ProjectDelivery (Pattern: OH, Mechanism: api)
- CustomerOnboarding -> InvoicingBilling (Pattern: OH, Mechanism: event)
- PaymentProcessing -> NotificationDelivery (Pattern: ACL, Mechanism: event)
- IdentityAccess -> InvoicingBilling (Pattern: OH, Mechanism: api)
- InvoicingBilling -> ReportingAnalytics (Pattern: OH, Mechanism: api)
- IdentityAccess -> ProjectDelivery (Pattern: OH, Mechanism: api)
