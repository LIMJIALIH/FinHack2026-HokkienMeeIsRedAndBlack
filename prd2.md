# Product Requirements Document (PRD)

# **TNG Guardian Voice**

### Full Application PRD

### FINHACK 2026 Submission Version

### Status: Final Comprehensive Scope

---

# 1. Document Control

| Field            | Value                                          |
| ---------------- | ---------------------------------------------- |
| Product Name     | TNG Guardian Voice                             |
| Product Type     | AI-enabled eWallet Safety + Inclusion Platform |
| Primary Platform | Mobile-first Web App                           |
| Event            | FINHACK 2026                                   |
| Version          | 3.0                                            |
| Owner            | Product Team                                   |
| Status           | Final Draft                                    |

---

# 2. Executive Summary

TNG Guardian Voice is a multilingual, voice-first financial wallet experience designed to improve access to digital payments while proactively protecting users from scams.

The application addresses two major market problems:

## Problem A — Financial Inclusion

Large user segments still struggle with:

* low digital literacy
* elderly usability barriers
* language barriers
* fear of digital finance
* text-heavy onboarding journeys

## Problem B — Scam Losses

Users are manipulated into sending money via:

* fake investment schemes
* impersonation scams
* parcel/customs scams
* romance scams
* urgency-pressure scams
* mule account networks

## Product Solution

TNG Guardian Voice allows users to:

* onboard using guided voice assistance
* use wallet functions naturally through speech
* receive real-time scam warnings before transfers complete
* understand risks clearly
* transact with higher confidence

---

# 3. Vision Statement

Build the most accessible and trusted wallet experience in Malaysia.

---

# 4. Product Mission

Help more Malaysians participate safely in the digital economy.

---

# 5. Core Value Proposition

> Speak naturally. Send confidently. Stay protected.

---

# 6. Strategic Objectives

## Business Objectives

* Increase trust in wallet transfers
* Improve onboarding conversion
* Reduce scam-related losses
* Improve accessibility adoption
* Strengthen compliance posture

## User Objectives

* Easy onboarding
* Fast normal transfers
* Clear warnings on risky transfers
* Low-stress interface
* Multilingual support

---

# 7. Target Users

# Segment A — Rural / Underserved Users

Characteristics:

* limited digital confidence
* prefer spoken guidance
* may use lower-end devices

Needs:

* simple onboarding
* minimal text
* trust-building guidance

---

# Segment B — Elderly Users

Characteristics:

* higher scam vulnerability
* lower trust in apps

Needs:

* large UI controls
* clear confirmations
* warning protections

---

# Segment C — Mainstream Wallet Users

Characteristics:

* frequent transfers
* speed-sensitive

Needs:

* fast approvals
* silent background protection

---

# Segment D — Internal Risk / Compliance Teams

Needs:

* transaction visibility
* explainable alerts
* suspicious activity summaries

---

# 8. Product Principles

1. Safety without unnecessary friction
2. Inclusion without complexity
3. Explainability over black-box decisions
4. Fast for normal users
5. Calm intervention for risky actions

---

# 9. Product Scope

# In Scope (MVP + Demo)

## User App

* onboarding
* eKYC flow
* wallet home
* send money
* voice commands
* transaction confirmation
* scam warnings
* receipts

## Intelligence Layer

* message classification
* graph risk detection
* decision engine
* LLM warning generation

## Admin Dashboard

* transaction monitoring
* fraud graph
* risk analytics
* compliance summary

---

# Out of Scope

* real money movement rails
* full banking core
* production KYC operations
* customer support center
* native mobile app store release
* full AML investigation suite

---

# 10. Product Architecture Overview

```text id="h0q6rz"
User App
 ↓
Voice Copilot Layer
 ↓
Intent Extraction
 ↓
Guardian Signal Layer
 ↓
Scam Breaker Engine
 ↓
Graph Intelligence Store
 ↓
Decision Response
 ↓
LLM Warning Layer
 ↓
User App + Dashboard
```

---

# 11. Major Components

# 11.1 Voice Copilot Agent

Purpose:

Allow natural interaction with the wallet.

Capabilities:

* language selection
* onboarding guidance
* speech command capture
* transaction confirmations
* help prompts

Supported languages:

* Bahasa Melayu
* English
* Mandarin
* Tamil
* Manglish

---

# 11.2 Guardian Signal Layer

Purpose:

Generate structured signals before any LLM reasoning.

Models:

| Signal             | Meaning                      |
| ------------------ | ---------------------------- |
| Phishing Score     | Scam-like wording            |
| Urgency Score      | Pressure to act fast         |
| Manipulation Score | Emotional persuasion         |
| Neutrality Score   | Normal vs suspicious tone    |
| Coercion Score     | Threat / forced payment tone |

Why:

Improves explainability and consistency.

---

# 11.3 Scam Breaker Engine

Purpose:

Make real-time transfer decisions.

Outputs:

* APPROVED
* REVIEW_WARNING
* INTERVENTION_REQUIRED

Inputs:

* graph risk
* message risk
* amount anomaly
* recipient novelty
* user context

---

# 11.4 Graph Intelligence Layer

Stores suspicious relationships such as:

* shared IP addresses
* shared devices
* linked mule accounts
* repeated recipient patterns
* cluster proximity

---

# 11.5 Compliance Agent

Creates summaries of risky activity for internal review.

---

# 11.6 Dashboard

Used by judges/admins to visualize:

* blocked transactions
* risk reasons
* graph connections
* protected amount

---

# 12. User Journey Flows

# Flow A — First-Time User Onboarding

## Step 1: Launch

Splash screen:

> TNG Guardian Voice

CTA:

* Register
* Login
* Speak Now

---

## Step 2: Language Select

User chooses preferred language.

---

## Step 3: Guided Registration

Voice prompts request:

* full name
* phone number
* IC number

OTP verification follows.

---

## Step 4: eKYC

Upload:

* IC image
* selfie image

System returns:

* Verified / Retry

---

## Step 5: Wallet Ready

Home screen shown.

---

# Flow B — Safe Transfer

## User says:

> Send RM15 to Ali for lunch

## System extracts:

```json id="2svf9o"
{
  "amount": 15,
  "recipient": "Ali",
  "purpose": "lunch"
}
```

## Risk Signals

Low urgency, high neutrality.

## Decision

APPROVED.

## Result

Receipt shown instantly.

---

# Flow C — Scam Transfer

## User says:

> Send RM1000 to investment agent, must pay now for bonus

## Parsed Data

```json id="u3ey83"
{
  "amount": 1000,
  "recipient": "investment agent",
  "message": "must pay now for bonus"
}
```

## Guardian Signal Layer

```json id="1lca1m"
{
  "phishing_score": 0.88,
  "urgency_score": 0.95,
  "neutrality_score": 0.09,
  "manipulation_score": 0.81
}
```

## Graph Risk

* first-time recipient
* linked suspicious device
* new account

## Final Decision

INTERVENTION_REQUIRED.

## Warning Message

> Pause first. This payment appears risky. The request is urgent and the account is newly associated with suspicious activity.

## User Choices

* Cancel Transfer
* Continue Anyway
* Report Scam

---

# Flow D — Dashboard

Shows:

* 2 transactions checked
* 1 approved
* 1 interrupted
* RM1000 protected

Graph visualizes suspicious links.

---

# 13. Functional Requirements

# FR1 Authentication

System shall support registration and login.

---

# FR2 Voice Input

System shall accept spoken commands.

---

# FR3 Language Support

System shall support five languages.

---

# FR4 Onboarding

System shall guide user through registration.

---

# FR5 eKYC

System shall accept identity media uploads.

---

# FR6 Wallet Home

System shall display balance and actions.

---

# FR7 Transfer Creation

System shall support send-money flow.

---

# FR8 Risk Classification

System shall score message content.

---

# FR9 Graph Detection

System shall assess suspicious relationships.

---

# FR10 Decision Engine

System shall approve or interrupt transfers.

---

# FR11 Warning UX

System shall explain risk clearly.

---

# FR12 Dashboard

System shall expose internal risk metrics.

---

# FR13 Logging

System shall store decisions and reasons.

---

# 14. Non-Functional Requirements

# Performance

* safe transfer < 2 sec
* high-risk scoring < 3 sec

# Reliability

* graceful fallback mode

# Accessibility

* voice prompts
* large buttons
* readable text

# Privacy

* demo-safe mock data only

# Security

* encrypted traffic if deployed

---

# 15. UI Requirements

# Mobile User App Screens

1. Splash
2. Language Select
3. Register
4. eKYC
5. Home
6. Send Money
7. Confirm Transfer
8. Scam Warning Modal
9. Receipt
10. History

---

# Dashboard Screens

1. Overview
2. Fraud Graph
3. Alerts
4. Compliance Summary

---

# 16. Decision Logic (Illustrative)

```text id="mzwzv7"
Risk Score =
30% Graph Risk
30% Message Risk
20% Amount Anomaly
20% Recipient Novelty
```

Thresholds:

* 0–39 Approve
* 40–69 Warn
* 70+ Interrupt

---

# 17. Example API Contracts

# Transfer Request

```json id="d8m5n2"
{
  "user_id": "usr001",
  "amount": 1000,
  "recipient": "acct8899",
  "voice_text": "must pay now for bonus"
}
```

# Transfer Response

```json id="k6qjfw"
{
  "decision": "INTERVENTION_REQUIRED",
  "risk_score": 91,
  "reasons": [
    "high urgency",
    "investment wording",
    "new recipient"
  ]
}
```

---

# 18. Analytics & KPIs

* onboarding completion rate
* avg transfer latency
* risky transfer detection rate
* user cancellation after warning
* RM protected
* language usage mix

---

# 19. Demo Plan (FINHACK)

## Minute 1

Voice onboarding.

## Minute 2

Safe RM15 transfer approved.

## Minute 3

RM1000 scam payment attempted.

## Minute 4

Warning shown.

## Minute 5

Dashboard explains why.

---

# 20. Team Workstream Plan

## Frontend

* mobile UI
* dashboard UI

## Backend

* APIs
* scoring engine

## AI/ML

* classifier integration
* prompts

## Product/Pitch

* story
* slides
* demo control

---

# 21. Risks & Mitigation

| Risk                     | Mitigation                  |
| ------------------------ | --------------------------- |
| Voice recognition errors | typed fallback              |
| Demo internet issues     | local mock mode             |
| LLM latency              | call only on triggered risk |
| False positives          | warn, don’t hard block      |
| Scope creep              | focus MVP only              |

---

# 22. Future Roadmap

## Phase 2

* DuitNow integration
* live chat scam scanning
* trusted family approval mode
* elderly mode UI

## Phase 3

* real AML workflows
* adaptive personal risk models
* merchant fraud intelligence

---

# 23. Why This Product Wins

## Real Problem

Scams + inclusion are urgent.

## Strong Differentiation

Voice + graph + classifiers + explainable AI.

## Demo Friendly

Visible before/after outcome.

## Commercially Relevant

Useful for real wallet operators.

---

# 24. Final Summary

**TNG Guardian Voice is a multilingual voice-first wallet platform that helps Malaysians use digital finance confidently while detecting and interrupting suspicious transfers through classifier signals, graph intelligence, and grounded AI warnings before money is lost.**
