Here is the complete and finalized Product Requirements Document (PRD) for your Web App application, synthesizing all the architectural, functional, and user experience details discussed.

### **1. Product Overview & Vision**
* [cite_start]**Product Name:** TNG Guardian Voice[cite: 393].
* [cite_start]**Vision:** To protect vulnerable Malaysians from financial scams while providing digital banking accessibility to everyone through localized Voice AI[cite: 394].
* [cite_start]**Core Strategy:** A strict 50/50 balance between Financial Inclusion (accessibility) and Security (active fraud intervention)[cite: 395].

### **2. Target Audience & Problems**
* [cite_start]**Unbanked/Low-Income Users:** Struggle with complex, text-heavy UIs and low digital literacy[cite: 396].
* [cite_start]**Elderly & Vulnerable Groups:** Highly susceptible to social engineering scams (e.g., Macau or investment scams) that bypass standard warnings[cite: 397].
* [cite_start]**Regulators:** Need faster, more transparent reporting of mule account networks[cite: 398].

### **3. Key Functional Requirements**

**3.1. Voice Inclusion Copilot (Financial Inclusion)**
* [cite_start]**Multilingual Support:** Must support Bahasa Melayu, English, Mandarin, Tamil, and regional dialects like Manglish[cite: 399].
* [cite_start]**Voice-First Onboarding:** Guides users through registration and ID submission entirely via voice[cite: 400].
* [cite_start]**Conversational Transactions:** Allows transfers and balance checks via natural language (e.g., "Send RM15 to Ali")[cite: 401].

**3.2. BERT Neutrality Layer (Deterministic Sensor)**
* [cite_start]**Feature Extraction:** Acts as a "hard" data filter between speech-to-text and the LLM reasoning[cite: 402].
* [cite_start]**Toxic BERT:** Identifies aggressive language or bullying used in social engineering[cite: 403].
* [cite_start]**Emotional Classifier:** Detects high urgency, panic, or fear (e.g., "urgent legal fine")[cite: 404].
* [cite_start]**Phishing Model:** Scans transaction notes for deceptive patterns or malicious links[cite: 405].

**3.3. Scam-Breaker Engine (Security & Fraud)**
* [cite_start]**Active Agentic Intervention:** Uses a two-stage process to move from passive scoring to "pattern interrupts"[cite: 406].
* [cite_start]**Contextual Dialogue:** Triggers a safety conversation when high-risk transfers are detected (e.g., asking about contact via Telegram)[cite: 407].

**3.4. Trust Dashboard & Two-Speed Graph Strategy (Compliance)**
* [cite_start]**Graph Visualization:** Displays a relationship map of fraud rings with connected nodes (IPs, devices, accounts)[cite: 408].
* [cite_start]**Automated Compliance:** Generates real-time draft Suspicious Transaction Reports (STRs) for blocked transfers[cite: 409].
* [cite_start]**Two-Speed Architecture:** Utilizes synchronous 100ms 1-hop checks for real-time blocks versus asynchronous deep-search batch jobs for complex AML laundering[cite: 514].

### **4. Technical Architecture (Dual-Cloud Strategy)**
* [cite_start]**Alibaba Cloud Zoloz eKYC:** Biometric face-matching and liveness checks for remote onboarding[cite: 411].
* [cite_start]**Alibaba Cloud PAI / Qwen LLM:** Regional NLP to understand localized Malaysian slang and dialects[cite: 412].
* [cite_start]**Alibaba Cloud ApsaraDB:** High-speed transactional ledger for core eWallet operations and eKYC storage[cite: 413].
* [cite_start]**AWS Amazon Neptune:** Graph database to map and visualize fraud rings in real-time[cite: 414].
* [cite_start]**AWS Amazon Bedrock:** Orchestrates specialized agents and generates contextual safety prompts[cite: 415].
* [cite_start]**AWS Lambda:** Runs the BERT Trio and executes 50-100ms fraud queries to prevent lag[cite: 416].

### **5. User Journey & Web App Flow**
[cite_start]The prototype utilizes a full-screen Web Application layout with a main navigation top-bar or sidebar menu to switch between 'Customer Wallet' and 'Regulatory Dashboard'[cite: 499].

**Customer Wallet View**
* [cite_start]**Dashboard/Home:** Display the current balance and a list of recent transactions[cite: 502]. [cite_start]Include the transfer simulation controls clearly on the screen[cite: 503].
* [cite_start]**Safe Transfer Flow:** When triggered, show a brief processing state, then instantly add the transaction to the recent list and update the balance to demonstrate low latency[cite: 504].
* [cite_start]**Scam Transfer Flow (Scam-Breaker Engine):** When triggered, show a processing state, then present a prominent, high-visibility intervention overlay or modal[cite: 505]. [cite_start]Display the Scam-Breaker agent's dialogue asking if someone on Telegram promised a high-return investment[cite: 506]. [cite_start]Explicitly list the BERT intent scores and Neptune flags as the 'Explainable AI' reasoning[cite: 507]. [cite_start]Provide controls to cancel or proceed[cite: 508].

**Regulatory Dashboard View**
* [cite_start]**Header:** Display the high-level dashboard metrics (Protected amount, Threats Blocked)[cite: 509].
* [cite_start]**Graph Visualization Panel:** Render a visual node-link diagram representing the blocked fraud ring[cite: 510].
* [cite_start]**Compliance STR Panel:** Below or beside the graph, display an auto-generated Suspicious Transaction Report (STR) detailing the blocked scam transaction[cite: 513].

### **6. Success Metrics**
* [cite_start]**Scam Protection:** Ability to intercept a simulated social engineering scam[cite: 422].
* [cite_start]**Latency:** Backend graph and BERT checks must occur in under 100ms for a smooth UX[cite: 423].
* [cite_start]**Explainability (XAI):** Proven ability to show exactly why a transfer was flagged using deterministic scores[cite: 424].
* [cite_start]**Inclusion:** Successful voice-only onboarding for a non-technical user[cite: 425].