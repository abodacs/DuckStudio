# Building Agentic Workflows with WebMCP Tools

Build your user's agentic workflows with WebMCP tools. This guide covers how to design tools and conversations that guide an agent from a user goal to a successful outcome.

## Define the User Goal

Users interact with an agent with a specific goal, ranging from small questions to multi-step workflows. When defining these goals, consider:

- **What is the ideal outcome?** Clearly define what "success" looks like for the user.
- **What context is required?** Determine what specific information or data the agent needs to achieve the goal.
- **What are the boundaries?** Define what the agent should not do or what actions are restricted.
- **Which goals to prioritize?** Start by identifying journeys where agentic support offers the most added value. Look for opportunities where a conversational approach enables a more natural, efficient, or intuitive path for the user to achieve their goal compared to a UI-driven experience.

## Define the Initial State

Once you understand the user's goal, establish the "starting line." The initial state defines the environment and context before the agent takes action.

Consider the following dimensions:

- **Application state:** Where is the user in your product? What data is visible or active? (e.g., viewing a specific project, on the dashboard, or in settings)
- **Agent context:** What has already been discussed? What information does the agent already possess, and what is it missing?
- **System constraints:** Are there active filters, user permissions, or system-wide settings that limit what the agent can do immediately? (e.g., if the goal requires login, does the flow start before or after login?)

Once defined, you can better determine what tools the agent needs from the start to be effective. There may be additional tools needed later in the interaction, which you can discover by role-playing the scenario.

## Role-play the Conversation

Role-playing simulates the entire conversation between the user and the agent. This is how you identify which tools your site needs to support each step, and how the site should react when those tools are called.

Follow this process to test your assumptions:

1. **Map the conversation:** Imagine the full interaction, turn-by-turn, from the user's initial goal to the final resolution. The conversation should reflect how end users use your product, rather than internal teams.
2. **Analyze tool and site needs:** At each turn, ask:
   - What information does the agent need from your product to reply?
   - What actions must it perform?
   - What tools are required to support those actions?
   - How should your site react when those tools are called?
3. **Iterate and refine:** If you identify a gap or a missing tool during this simulation, repeat steps 1 and 2 to refine your plan. Then resume the simulation.

### Example: Flight Booking

To see this in action, walk through a flight booking scenario for a business trip. Imagine a user is on the travel dashboard and wants to book a flight to New York for next Tuesday.

- **User goal:** Successfully book a flight that adheres to corporate policy.
- **Initial state:** The user is on the travel dashboard. The agent can access the user's corporate profile, which includes saved preferences (such as airline and ticket class).
- **Role-play:** The user requests the options, adds criteria, and books a flight.

### Tip: Accelerate Your Design Process

Provide an AI agent with your defined user goal and initial state. Ask it to simulate a conversation that demonstrates the necessary tool invocations and expected UI updates.

## Skills as Self-Loading Tools

WebMCP gives you no mechanism to inject protocols into the agent's context. You could pack protocol knowledge into tool descriptions, but that muddies the tool's own purpose and breaks down quickly: the same tool can be used by multiple skills, so whose protocol goes in the description? Use a cleaner way to deliver multi-step instructions to the agent on demand.

A tool has two surfaces: its description (what the agent sees when scanning available tools) and its return value (what the agent receives after calling it). Use one for discovery and the other for delivery.

Register each skill as a zero-argument tool. The description is a one-sentence summary, just enough for the agent to recognize the skill as relevant. Calling the tool returns the full step-by-step protocol. The agent loads knowledge exactly when it needs it, and not before.

```
skill_fulfill_bundle
  description: "Protocol for fulfilling a custom gift bundle order."
  returns: "Gift Bundle Fulfillment Protocol:
            1. Call get_order to read the requested items and any special instructions.
            2. For each item, call check_stock. If unavailable, call find_substitute.
            3. Call reserve_item for each confirmed item.
            4. If gift wrap was requested, call add_gift_wrap.
            5. Call generate_packing_slip with the final item list.
            6. Call schedule_pickup."
```

## Address Variance

A user may be vague when asking for help from an agent. For example, they may say "I need to go to NYC next week." This request doesn't indicate a specific day, so you should build tools that are flexible enough for the agent to ask for missing parameters ("Which day next week?"), instead of making assumptions which may lead to failure.

By anticipating these variations in role-play, you ensure your tools provide the necessary information for the agent to resolve ambiguity effectively.

## Fail Gracefully and Enable Recovery

When an agent attempts to execute a tool in an invalid state, with malformed parameters, or when a tool receives unexpected data from an underlying system, the response should act as a guide rather than a dead end. Always provide context-aware feedback to help the agent recover; avoid returning generic error messages, raw API errors, or failing silently.

Examples of recovery-friendly error responses:

- **Wrong state or missing prerequisites:** "No flight search results found. Search for flights first."
- **Invalid parameters:** "Invalid date format. Provide the date in YYYY-MM-DD format."
- **Unexpected return values:** "No flights found matching your criteria. Try adjusting your search parameters."
- **Business logic violations:** "Order 123 has already shipped. Redirect the user to the returns policy."

By providing explicit, actionable feedback, you enable the agent to inform the user immediately and pivot the conversation effectively, preventing confusion and ensuring a seamless experience.

## Evaluate Your Tools

Documenting user goals, state transitions, and conversational paths provides a blueprint for building automated evaluations (evals). When testing systems that use generative AI, you must account for probabilistic outcomes that don't match your expectations. Evals can help you verify consistent tool selection, parameter extraction, and state management.

## Deploy to Production

Role-playing is great for the initial prototype of a tool. To implement in production, you should complement it with real-world telemetry.

Once a tool is deployed, analyze your interaction logs to identify where agents struggle or deviate from expected paths. Use those insights to continuously update your evals and tool definitions.

## Engage and Share Feedback

Building tools for AI agents is continuous, iterative work. By focusing on your user's goals, carefully defining the starting state, and role-playing through different conversational styles, you can design tools that don't just perform tasks, but actively guide the AI agent toward successful outcomes.

As you build and evaluate, keep the conversation between the user and the agent at the center of your site. The conversation should drive the tools and site design to best meet your user's experience.
