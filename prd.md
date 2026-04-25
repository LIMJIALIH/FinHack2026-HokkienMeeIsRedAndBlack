# Product Requirements Document (PRD)

## TNG Guardian Voice

### Version
Integrated from `prd1.md` and `prd2.md` on 2026-04-25.

---

## 1. Product Overview

TNG Guardian Voice is a multilingual, voice-first wallet platform designed to improve financial inclusion while actively preventing scam losses.

The product balances two priorities:
- Inclusion: make digital finance usable for low-literacy and underserved users.
- Security: detect and interrupt high-risk transfers before funds are lost.

Core product promise:
- Speak naturally.
- Send confidently.
- Stay protected.

---

## 2. Problem Statement

### Financial Inclusion Problem
Many users still struggle with text-heavy onboarding, low digital confidence, language barriers, and fear of digital finance.

### Scam Protection Problem
Users are frequently manipulated by social engineering patterns such as fake investments, impersonation scams, urgency pressure, and mule-account transfer routes.

---

## 3. Goal, Solution, and Impact

### Goal
Build one trusted wallet experience that is both highly accessible and highly protective for Malaysians.

### Solution
Provide voice-led onboarding and transaction flows, then score each transfer using deterministic language signals plus graph risk checks, and trigger clear intervention when risk is high.

### Expected Impact
- Increase onboarding completion among underserved users.
- Reduce successful scam transfer attempts.
- Improve user trust in wallet transfers.
- Strengthen explainable internal compliance reporting.

---

## 4. Target Users

- Rural and underserved users with low digital literacy.
- Elderly users with higher scam vulnerability.
- Mainstream wallet users who require fast low-friction transfers.
- Internal risk and compliance teams who need clear risk visibility.

---

## 5. User Stories

- As a low-literacy user, I want guided voice onboarding so I can register without complex forms.
- As a multilingual user, I want to use my preferred language so I can transact with confidence.
- As a wallet user, I want normal transfers to stay fast so my daily usage is not slowed.
- As a vulnerable user, I want clear risk warnings before suspicious transfers so I can avoid scams.
- As a compliance analyst, I want explainable risk signals and graph context so I can justify intervention outcomes.

---

## 6. Functional Scope

### 6.1 Voice Inclusion Copilot
- Supports Bahasa Melayu, English, Mandarin, Tamil, and Manglish.
- Guides users through onboarding and key wallet tasks by voice.
- Supports conversational actions such as balance inquiry and transfer intent capture.

### 6.2 Guardian Signal Layer (Deterministic)
- Runs pre-LLM signal extraction for explainability and consistency.
- Includes toxicity/manipulation, urgency/emotion, phishing/deception, and neutrality scoring.
- Produces structured signals used by downstream decision logic.

### 6.3 Scam Breaker Engine
- Combines message risk, graph risk, amount anomaly, recipient novelty, and user context.
- Produces decision outcomes:
  - `APPROVED`
  - `REVIEW_WARNING`
  - `INTERVENTION_REQUIRED`
- For high-risk cases, triggers contextual dialogue and actionable user choices.

### 6.4 Graph Intelligence and Compliance
- Maintains suspicious relationship context (shared IP/device, linked mule accounts, repeated patterns).
- Shows internal visualization for blocked/high-risk events.
- Produces compliance-oriented suspicious activity summaries (including STR-style drafts for blocked transfers).

### 6.5 User and Dashboard Journeys
- Customer wallet view: home balance, recent activity, send-money flow, scam warning modal, receipt/history.
- Regulatory dashboard view: protected amount, blocked threats, graph node-link view, compliance summary panel.

---

## 7. Technical Architecture

### 7.1 Application Architecture (Logical)
1. User App
2. Voice Copilot Layer
3. Intent Extraction
4. Guardian Signal Layer
5. Scam Breaker Engine
6. Graph Intelligence Store
7. Decision Response
8. Warning/Explanation Layer
9. User App and Dashboard Outputs

### 7.2 Dual-Cloud Deployment Strategy
- Alibaba Cloud components for eKYC, regional NLP handling, and wallet ledger storage.
- AWS components for graph intelligence, agent orchestration, and low-latency scoring execution.

Representative mapped services from source PRDs:
- Alibaba Zoloz eKYC
- Alibaba PAI/Qwen for localized language handling
- Alibaba ApsaraDB for transactional storage
- Amazon Neptune for fraud-relationship graph
- Amazon Bedrock for agentic warning generation
- AWS Lambda for low-latency risk/scoring paths

### 7.3 Two-Speed Risk Processing
- Synchronous real-time checks for in-flow transfer decisions, targeting sub-100ms graph/signal checks where feasible.
- Asynchronous deeper analysis for broader AML/fraud pattern expansion.

---

## 8. Decisioning and Explainability

Illustrative risk composition:
- 30% graph risk
- 30% message risk
- 20% amount anomaly
- 20% recipient novelty

Illustrative thresholds:
- 0-39: Approve
- 40-69: Warn/Review
- 70+: Intervention required

Explainability must include deterministic reasons (for example: high urgency score, phishing language score, suspicious graph linkage) shown in both user warning context and dashboard context.

---

## 9. Non-Functional Requirements

- Performance:
  - Normal transfers should complete quickly (target under 2 seconds end-to-end UX).
  - High-risk scoring and intervention should remain responsive (target under 3 seconds UX).
  - Real-time risk components should support low-latency checks (sub-100ms component-level target where applicable).
- Reliability:
  - Graceful fallback when model or network paths degrade.
- Accessibility:
  - Voice prompts, large controls, and readable text hierarchy.
- Privacy and Security:
  - Demo-safe data handling for hackathon environments.
  - Encrypted transport when deployed.
- Explainability:
  - Every warning/intervention must provide reason codes and signal traces.

---

## 10. Acceptance Criteria

### AC1 Onboarding Accessibility
- Given a new user, when voice onboarding is started, then user can complete registration and eKYC steps with guided prompts.

### AC2 Multilingual Operation
- Given a supported language selection, when user provides voice intent, then system understands and executes core wallet actions.

### AC3 Safe Transfer Path
- Given low-risk transfer intent, when transfer is submitted, then transaction is approved quickly and receipt is shown.

### AC4 Scam Intervention Path
- Given high-risk transfer intent, when transfer is submitted, then user sees intervention dialog with explainable risk reasons and options to cancel/proceed/report.

### AC5 Dashboard Explainability
- Given blocked or warned transfers, when viewed in dashboard, then risk reasons, graph links, and protected amount are visible.

### AC6 Compliance Output
- Given intervention-required events, when compliance panel is opened, then suspicious activity summary (STR-style draft) is generated.

---

## 11. Out of Scope

- Live banking rails and production settlement.
- Full production-grade KYC/AML operations.
- Complete customer support center workflows.
- Native app store distribution in current scope.
- Full enterprise AML investigation suite.

---

## 12. KPIs and Success Metrics

- Onboarding completion rate.
- Average transfer latency.
- High-risk detection/intervention rate.
- User cancellation rate after warning.
- Total protected amount (RM).
- Language usage distribution.

---

## 13. Demo Scenario (FINHACK)

1. Voice-guided onboarding sample.
2. Safe low-value transfer approved.
3. High-risk transfer attempt initiated.
4. Scam warning and intervention shown with reasons.
5. Dashboard displays blocked risk graph and protected amount.

---

## 14. Alignment Verdict

`prd1.md` and `prd2.md` are aligned in intent and architecture.

- `prd1.md` provides concise core requirements and explicit cloud/service mapping.
- `prd2.md` expands structure, flows, requirement coverage, and operational detail.

This integrated PRD treats `prd2.md` as the expanded baseline and merges specific concrete details from `prd1.md`.
