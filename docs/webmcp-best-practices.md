# WebMCP Tool Best Practices

**Status:** external reference, not a canonical contract. This document collects the 2026 `modern-web-guidance` WebMCP guidance for authoring model-facing tools. The canonical DuckStudio contracts remain `PRODUCT.md`, `docs/agent-system-design.md`, `docs/prd.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/video-script.md`. Where this guidance changes a DuckStudio decision, that change is recorded in the canonical doc, not here.

## Tool strategy

- Build a tool strategy before building.
- One tool = one function. Do not create overlapping tools; ask "can I cover multiple tasks with the same function?"
- Distinguish execution from initiation in the name: `create-event` creates now, `start-event-creation-process` redirects to a form.
- Manage registration: register when useful in a page state, unregister when no longer usable. For most applications, static registration is the default.

## Language

- Clear, precise names and descriptions. Trust the agent to complete the task — avoid rigid or negative instructions.
- Describe what the tool does and when to use it. Prefer positive language; let limitations stay implicit in a well-written description.
- Do not write "Don't use this tool for X." Write "This tool can create a calendar event, scheduled for a specific date and time."

## Minimize cognitive computing

- Accept raw user input. Do not ask the model to perform math or transform strings; accept `"11:00 to 15:00"` as-is.
- Declare specific parameter types: `string`, `number`, `enum`.
- Explain *why* a choice exists — the *what* should be self-explanatory. Prefer natural language over ambiguous IDs (`shipping="Express"`, not `shipping_id=1`).

## Reliability

- Set graceful failure for rate limits; allow reasonable repetition and return a meaningful error or advise manual action.
- Update interface state after functions complete. The agent should confirm completion once the interface has updated, or request an update again.
- Validate strictly in code, loosely in schema. Schema constraints are not guaranteed; add descriptive errors in function code so the model can self-correct and retry.

## Eval and debugging

- Evaluation-driven development: a repeatable process for improving outputs, catching regressions, and aligning behavior with expectations. Unlike deterministic unit tests, evaluations cannot be hard-coded.
- Frame the problem like an API contract (input type, output format, constraints). Define a baseline and an ideal result. Choose an evaluation method: code-based checks for rule-based outputs, LLM-as-a-judge for qualitative outputs.
- Avoid adding narrow rules to patch a single model's behavior. Abstract and adjust the tool (e.g., make a field optional and ask the user) instead.

## Character budgets

To avoid agent guardrails, keep text succinct:

| Element                    |            Limit |
| -------------------------- | ---------------: |
| Tool description           |   500 characters |
| Parameter description      |   150 characters |
| Tool name / parameter name |    30 characters |
| Individual tool output     | 1.5 K characters |

## Origin trust

Only expose tools to origins you trust, especially tools that manage user data or act on the user's behalf:

- A read-only tool can reveal user information; expose it only to websites you would share that data with directly.
- A read/write tool acts on the user's behalf; expose it only to origins you decide can be trusted. `postComment` on `trustedExample.com`, never `evilExample.com`.

## Transparency, trust calibration, control

- Guide users to express intent clearly: prompt suggestions and suggested follow-ups.
- Make system state and assumptions visible: the agent states what it understands and what information it uses.
- Ask before acting on sensitive actions (returns, refunds, address changes).
- Design for verification and correction: correct misunderstandings, rephrase, or rewind without starting over.
- Combine with constrained AI features (structured shortcuts) to reduce back-and-forth.
- Surface uncertainty and limitations; escalate to a human when confidence is low.

## Fail gracefully and enable recovery

A tool called in an invalid state, with malformed parameters, or with unexpected data should act as a guide, not a dead end. Always provide context-aware feedback; never return generic errors, raw API errors, or fail silently.

- Wrong state / missing prerequisite: "No flight search results found. Search for flights first."
- Invalid parameter: "Invalid date format. Provide the date in YYYY-MM-DD format."
- Unexpected return value: "No flights found matching your criteria. Try adjusting your search parameters."
- Business-logic violation: "Order 123 has already shipped. Redirect the user to the returns policy."

# Tips and External Reading

Curated links to posts, talks, and notes that complement DuckStudio's design. Tips are commentary from outside the project; the canonical contracts still live in `PRODUCT.md`, `docs/agent-system-design.md`, `docs/prd.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/video-script.md`.

## WebMCP: Tools as Skills

[WebMCP: Tools as Skills](https://bandarra.me/posts/webmcp-tools-as-skills) — frames the WebMCP tool surface as composable agent skills, useful for thinking about how a small, well-shaped tool set supports long, multi-step work.

## WebMCP: Tool Best Practices

[WebMCP Tool Best Practices](./webmcp-best-practices.md) — the collected 2026 `modern-web-guidance` guidance for authoring model-facing tools: one tool = one function, positive language, specific types, character budgets, graceful recovery, and origin trust.