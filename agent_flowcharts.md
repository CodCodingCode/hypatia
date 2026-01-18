# Hypatia Agent System Flowcharts

## Agent Count Summary
**Total: 11 Agents**
- 3 Main Agents
- 1 Utility Agent
- 3 Debate Sub-Agents
- 2 Debate Orchestrators
- 2 Manager/Coordination Agents

---

## 1. PeopleFinderAgent

```mermaid
flowchart TD
    Start([Start: find contact]) --> LoadCampaign[Load campaign data]
    LoadCampaign --> SearchDesc{Try Aviato DSL<br/>Search with Description}
    SearchDesc -->|Success| ValidateAviato{Results valid?}
    ValidateAviato -->|Yes| Return1[Return contacts]
    ValidateAviato -->|No| SearchPipeline
    SearchDesc -->|Fail| SearchPipeline{Try Pipeline<br/>Enrichment Search}
    SearchPipeline -->|Success| ValidatePipeline{Results valid?}
    ValidatePipeline -->|Yes| Return2[Return contacts]
    ValidatePipeline -->|No| SearchClado
    SearchPipeline -->|Fail| SearchClado{Try Clado AI<br/>Fallback Search}
    SearchClado -->|Success| Return3[Return contacts]
    SearchClado -->|Fail| Error[Return empty/error]
    Return1 --> End([End])
    Return2 --> End
    Return3 --> End
    Error --> End

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style SearchDesc fill:#87CEEB
    style SearchPipeline fill:#87CEEB
    style SearchClado fill:#87CEEB
```

**Purpose:** Three-tier fallback system to find contacts
**Strategy:** Aviato DSL → Pipeline Enrichment → Clado AI

---

## 2. WriterAgent

```mermaid
flowchart TD
    Start([Start: write email]) --> LoadData[Load campaign & contact data]
    LoadData --> InitDebate[Initialize DebateOrchestrator]
    InitDebate --> RunDebate{Run 3-Agent Debate}
    RunDebate --> StyleDraft[StyleAgent: Create draft]
    StyleDraft --> CTACritique[CTAAgent: Critique CTA]
    CTACritique --> StyleRevise1[StyleAgent: Revise for CTA]
    StyleRevise1 --> BPCritique[BestPracticeAgent: Critique]
    BPCritique --> StyleRevise2[StyleAgent: Final revision]
    StyleRevise2 --> Template[Get EmailTemplate]
    Template --> Personalize[Fill placeholders:<br/>first_name, last_name]
    Personalize --> Return[Return personalized email]
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style RunDebate fill:#FFD700
    style StyleDraft fill:#DDA0DD
    style CTACritique fill:#87CEEB
    style BPCritique fill:#87CEEB
```

**Purpose:** Uses internal debate system to write personalized emails
**Key Feature:** Collaborative 3-agent debate (Style, CTA, BestPractice)

---

## 3. FollowupAgent

```mermaid
flowchart TD
    Start([Start: plan followups]) --> LoadData[Load campaign data<br/>& sample emails]
    LoadData --> ExtractFacts[FactExtractorAgent:<br/>Extract grounded facts]
    ExtractFacts --> GeneratePlan[Generate follow-up plan<br/>Day 3, 7, 14]
    GeneratePlan --> Email1{Generate Email 1<br/>Day 3}
    Email1 --> Validate1{Has grounded facts?}
    Validate1 -->|Yes| Email2
    Validate1 -->|No| Regenerate1[Regenerate with facts]
    Regenerate1 --> Email2{Generate Email 2<br/>Day 7}
    Email2 --> Validate2{Has grounded facts?}
    Validate2 -->|Yes| Email3
    Validate2 -->|No| Regenerate2[Regenerate with facts]
    Regenerate2 --> Email3{Generate Email 3<br/>Day 14}
    Email3 --> Validate3{Has grounded facts?}
    Validate3 -->|Yes| Return[Return 4-email cadence]
    Validate3 -->|No| Regenerate3[Regenerate with facts]
    Regenerate3 --> Return
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style ExtractFacts fill:#FFD700
    style Validate1 fill:#FF6B6B
    style Validate2 fill:#FF6B6B
    style Validate3 fill:#FF6B6B
```

**Purpose:** Creates 3-email follow-up sequences (Days 3, 7, 14)
**Key Feature:** Grounded fact extraction prevents hallucination

---

## 4. FactExtractorAgent

```mermaid
flowchart TD
    Start([Start: extract facts]) --> ReceiveEmail[Receive sample email text]
    ReceiveEmail --> Analyze[LLM: Analyze email content]
    Analyze --> Extract{Extract only<br/>verifiable facts}
    Extract --> ValueProps[Identify value propositions]
    Extract --> Claims[Identify specific claims]
    Extract --> CTAs[Identify CTAs & next steps]
    ValueProps --> Combine[Combine into<br/>ExtractedEmailFacts]
    Claims --> Combine
    CTAs --> Combine
    Combine --> Validate{Facts are explicit<br/>& verifiable?}
    Validate -->|Yes| Return[Return facts model]
    Validate -->|No| Retry[Retry extraction]
    Retry --> Extract
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style Extract fill:#87CEEB
    style Validate fill:#FF6B6B
```

**Purpose:** Extracts verifiable facts from sample emails
**Output:** Structured model with value props, claims, CTAs

---

## 5. StyleDebateAgent

```mermaid
flowchart TD
    Start([Start: respond in debate]) --> CheckRound{What round?}
    CheckRound -->|Round 1| InitialDraft[Create initial email draft]
    InitialDraft --> ApplyStyle[Apply user's writing style:<br/>tone, vocabulary, personality]
    ApplyStyle --> Placeholders[Use only first_name,<br/>last_name placeholders]
    Placeholders --> ReturnDraft[Return draft]

    CheckRound -->|Round 2+| ReceiveFeedback[Receive feedback from<br/>CTA or BestPractice agent]
    ReceiveFeedback --> Analyze[Analyze critique]
    Analyze --> Revise[Revise email]
    Revise --> MaintainStyle[Maintain original style]
    MaintainStyle --> ReturnRevised[Return revised draft]

    ReturnDraft --> End([End])
    ReturnRevised --> End

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style InitialDraft fill:#DDA0DD
    style Revise fill:#DDA0DD
```

**Role:** Drafts and revises emails matching user's style
**Constraint:** Only uses {first_name} and {last_name} placeholders

---

## 6. CTADebateAgent

```mermaid
flowchart TD
    Start([Start: critique CTA]) --> ReceiveDraft[Receive current email draft]
    ReceiveDraft --> EvalClarity{Evaluate: Is ask<br/>crystal clear?}
    EvalClarity --> EvalPlacement{Evaluate: Is CTA<br/>prominently placed?}
    EvalPlacement --> EvalSpecific{Evaluate: Specific<br/>next step defined?}
    EvalSpecific --> EvalTone{Evaluate: Tone<br/>appropriate?}
    EvalTone --> EvalFriction{Evaluate: Low<br/>friction action?}
    EvalFriction --> ComposeFeedback[Compose specific feedback]
    ComposeFeedback --> Critique{CTA meets all<br/>criteria?}
    Critique -->|Yes| Approve[Approve with minor notes]
    Critique -->|No| Recommend[Recommend specific changes]
    Approve --> Return[Return feedback]
    Recommend --> Return
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style Critique fill:#FF6B6B
    style ComposeFeedback fill:#87CEEB
```

**Role:** Ensures call-to-action is clear and compelling
**Criteria:** Clarity, placement, specificity, tone, friction

---

## 7. BestPracticeDebateAgent

```mermaid
flowchart TD
    Start([Start: critique best practices]) --> ReceiveDraft[Receive current email draft]
    ReceiveDraft --> EvalSubject{Evaluate: Subject line<br/>under 50 chars?}
    EvalSubject --> EvalPersonal{Evaluate: Meaningful<br/>personalization?}
    EvalPersonal --> EvalLength{Evaluate: Email body<br/>under 100 words?}
    EvalLength --> EvalStructure{Evaluate: Clear<br/>structure & flow?}
    EvalStructure --> EvalSpam{Evaluate: No<br/>spam signals?}
    EvalSpam --> EvalDeliver{Evaluate: Good<br/>deliverability?}
    EvalDeliver --> ComposeFeedback[Compose specific feedback]
    ComposeFeedback --> Critique{Meets cold email<br/>best practices?}
    Critique -->|Yes| Approve[Approve with minor notes]
    Critique -->|No| Recommend[Recommend specific changes]
    Approve --> Return[Return feedback]
    Recommend --> Return
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style Critique fill:#FF6B6B
    style ComposeFeedback fill:#87CEEB
```

**Role:** Applies cold email best practices
**Areas:** Subject line, personalization, length, structure, spam, deliverability

---

## 8. DebateOrchestrator

```mermaid
flowchart TD
    Start([Start: orchestrate debate]) --> Init[Initialize 3 debate agents:<br/>Style, CTA, BestPractice]
    Init --> Round1[Round 1: StyleAgent drafts]
    Round1 --> Round2[Round 2: CTAAgent critiques]
    Round2 --> Revise1[StyleAgent revises for CTA]
    Revise1 --> Round3[Round 3: BestPracticeAgent<br/>critiques]
    Round3 --> Revise2[StyleAgent final revision]
    Revise2 --> Extract[Extract final template]
    Extract --> Validate{Template has required<br/>placeholders?}
    Validate -->|Yes| Return[Return EmailTemplate]
    Validate -->|No| Retry[Retry debate]
    Retry --> Round1
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style Round1 fill:#DDA0DD
    style Round2 fill:#87CEEB
    style Round3 fill:#87CEEB
```

**Purpose:** Orchestrates round-robin debate between 3 agents
**Flow:** Style drafts → CTA critiques → Style revises → BP critiques → Style revises

---

## 9. LangGraphDebateOrchestrator

```mermaid
flowchart TD
    Start([Start: LangGraph debate]) --> InitState[Initialize DebateState]
    InitState --> DraftNode[Node: draft_initial<br/>StyleAgent creates draft]
    DraftNode --> CTANode[Node: critique_cta<br/>CTAAgent critiques]
    CTANode --> ReviseNode1[Node: revise_for_cta<br/>StyleAgent revises]
    ReviseNode1 --> BPNode[Node: critique_bp<br/>BestPracticeAgent critiques]
    BPNode --> ReviseNode2[Node: revise_for_bp<br/>StyleAgent final revision]
    ReviseNode2 --> LogComm[Log all agent communications]
    LogComm --> CheckRounds{Max rounds<br/>reached?}
    CheckRounds -->|No| CTANode
    CheckRounds -->|Yes| Return[Return template & logs]
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style DraftNode fill:#DDA0DD
    style CTANode fill:#87CEEB
    style BPNode fill:#87CEEB
    style LogComm fill:#FFD700
```

**Purpose:** LangGraph-based debate with explicit state management
**Features:** Graph workflow, communication logging, conditional looping

---

## 10. ManagerAgent

```mermaid
flowchart TD
    Start([Start: orchestrate campaign]) --> LoadCampaign[Load campaign from Supabase]
    LoadCampaign --> LoadContact[Load contact data]
    LoadContact --> Agent1{PeopleFinderAgent:<br/>Find contacts}
    Agent1 --> Validate1{Contacts found?}
    Validate1 -->|No| Error1[Log error]
    Validate1 -->|Yes| Agent2{WriterAgent:<br/>Write personalized emails}
    Agent2 --> Validate2{Email created?}
    Validate2 -->|No| Error2[Log error]
    Validate2 -->|Yes| Agent3{FollowupAgent:<br/>Create follow-up plan}
    Agent3 --> Validate3{Plan created?}
    Validate3 -->|No| Error3[Log error]
    Validate3 -->|Yes| WriteFiles[Write output files:<br/>email.txt, followup_plan.json]
    WriteFiles --> End([End])
    Error1 --> End
    Error2 --> End
    Error3 --> End

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style Agent1 fill:#FFD700
    style Agent2 fill:#FFD700
    style Agent3 fill:#FFD700
```

**Purpose:** Orchestrates 3 main agents using real campaign data
**Flow:** Load data → Find people → Write emails → Plan followups → Output files

---

## 11. LangGraphManagerAgent

```mermaid
flowchart TD
    Start([Start: LangGraph orchestration]) --> InitGraph[Initialize StateGraph]
    InitGraph --> LoadNode[Node: load_campaign<br/>DataLoaderAgent loads from Supabase]
    LoadNode --> LogLoad[Log: Campaign loaded]
    LogLoad --> FindNode[Node: find_people<br/>PeopleFinderAgent finds contacts]
    FindNode --> LogFind[Log: Contacts found]
    LogFind --> WriteNode[Node: write_emails<br/>WriterAgent + DebateOrchestrator]
    WriteNode --> LogWrite[Log: Emails written]
    LogWrite --> FollowupNode[Node: plan_followups<br/>FollowupAgent creates plan]
    FollowupNode --> LogFollowup[Log: Followups planned]
    LogFollowup --> OutputNode[Node: generate_output<br/>OutputGenerator writes files]
    OutputNode --> LogOutput[Log: Files generated]
    LogOutput --> CompileLog[Compile communication log<br/>showing all agent handoffs]
    CompileLog --> Return[Return results & full log]
    Return --> End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C6
    style LoadNode fill:#FFD700
    style FindNode fill:#FFD700
    style WriteNode fill:#FFD700
    style FollowupNode fill:#FFD700
    style OutputNode fill:#FFD700
    style CompileLog fill:#87CEEB
```

**Purpose:** Multi-agent orchestration using LangGraph with full logging
**Special Feature:** Generates detailed communication log showing agent reasoning

---

## System Architecture Overview

```mermaid
flowchart TB
    subgraph Managers["Manager Layer"]
        M1[ManagerAgent]
        M2[LangGraphManagerAgent]
    end

    subgraph Main["Main Agent Layer"]
        A1[PeopleFinderAgent]
        A2[WriterAgent]
        A3[FollowupAgent]
        A4[FactExtractorAgent]
    end

    subgraph Debate["Debate Layer"]
        O1[DebateOrchestrator]
        O2[LangGraphDebateOrchestrator]
        D1[StyleDebateAgent]
        D2[CTADebateAgent]
        D3[BestPracticeDebateAgent]
    end

    subgraph Data["Data Layer"]
        DB[(Supabase)]
        Aviato[Aviato API]
        Clado[Clado API]
    end

    M1 --> A1
    M1 --> A2
    M1 --> A3
    M2 --> A1
    M2 --> A2
    M2 --> A3

    A1 --> Aviato
    A1 --> Clado
    A2 --> O1
    A2 --> O2
    A3 --> A4

    O1 --> D1
    O1 --> D2
    O1 --> D3
    O2 --> D1
    O2 --> D2
    O2 --> D3

    M1 --> DB
    M2 --> DB

    style Managers fill:#FFE4B5
    style Main fill:#E6E6FA
    style Debate fill:#FFE4E1
    style Data fill:#E0FFFF
```

---

## Agent Communication Flow

```mermaid
sequenceDiagram
    participant User
    participant Manager
    participant PeopleFinder
    participant Writer
    participant Debate
    participant Followup
    participant FactExtractor

    User->>Manager: Start campaign
    Manager->>PeopleFinder: Find contacts
    PeopleFinder-->>Manager: Return contacts
    Manager->>Writer: Write personalized emails
    Writer->>Debate: Start 3-agent debate
    Debate->>Debate: Style → CTA → Style → BP → Style
    Debate-->>Writer: Return template
    Writer-->>Manager: Return personalized email
    Manager->>Followup: Create follow-up plan
    Followup->>FactExtractor: Extract grounded facts
    FactExtractor-->>Followup: Return facts
    Followup->>Followup: Generate 3-email cadence
    Followup-->>Manager: Return follow-up plan
    Manager-->>User: Output files created
```

---

## Legend

- 🟢 Green: Start/Entry points
- 🔴 Pink: End/Exit points
- 🔵 Blue: Processing/Evaluation nodes
- 🟡 Yellow: Sub-agent calls
- 🟣 Purple: Content creation
- ⚠️ Red: Validation/Decision points
