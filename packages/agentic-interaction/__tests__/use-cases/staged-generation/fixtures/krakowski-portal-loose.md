# Krakowski Portal

This document outlines the architecture for the Krakowski Portal project. The system is split into several bounded contexts that work together to manage user identity, customer onboarding, billing, and project delivery.

---

## Identity & Access

The core of our user management.

**Responsibility**: User identity and access management
**Type**: core

### Aggregates

- **User** (Root)
  Fields:
  - `id` (key)
  - `username`
- **OnboardingState**
  Parent: Customer

### Use Cases

- RegisterUser (System actor)

---

## Customer Onboarding

Handles the onboarding pipeline for new customers.

**Responsibility**: Customer onboarding process
**Type**: core

### Aggregates

- **Customer** (Root)
  Fields:
  - `id` (key)

---

## Invoicing & Billing

**Responsibility**: Invoicing and billing management
**Type**: core

### Aggregates

- **Invoice** (Root)
  Fields:
  - `id` (key)

### Value Objects

- **Money**
  Rules:
  - Non-negative

### Events Published

- InvoicePaid

---

## Payment Processing

**Responsibility**: Payment processing via Stripe
**Type**: core

### Aggregates

- **Payment** (Root)
  Fields:
  - `id` (key)

### Events Published

- PaymentReceived

---

## Notification Delivery

**Responsibility**: Notification delivery via email and in-app
**Type**: supporting

---

## Project Delivery

**Responsibility**: Project lifecycle management
**Type**: core

### Aggregates

- **Project** (Root)
  Fields:
  - `id` (key)

---

## Reporting & Analytics

**Responsibility**: Reporting and analytics
**Type**: generic

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
