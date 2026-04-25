"""Transaction fraud-reasoning agent with LangGraph-native HITL via interrupt_on.

The agent gathers evidence using read-only graph tools, then calls
``execute_transfer`` when it's ready to move money.  ``interrupt_on``
pauses the graph *before* execution so the human can approve / reject.
"""

import json
import os
import uuid
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

from deepagents import create_deep_agent
from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphRecursionError
from langgraph.types import Command

from transaction_agent.graph_tools import (
    get_neptune_graph_overview_tool,
    get_transfer_edges_info_tool,
    get_user_node_info_tool,
    search_contact_nodes_tool,
)
from transaction_agent.tools import submit_llm_transfer_decision_tool


# ---------------------------------------------------------------------------
# Execute-transfer tool (the *only* tool gated by interrupt_on)
# ---------------------------------------------------------------------------

def execute_transfer(
    sender_user_id: str,
    recipient_id: str,
    amount: float,
    currency: str = "MYR",
    message: str = "",
    tx_note: str | None = None,
    risk_score: int = 0,
    reason_codes: list[str] | None = None,
    evidence_refs: list[str] | None = None,
    assistant_text: str = "",
) -> str:
    """Execute a wallet transfer after human approval.

    This tool will be **paused** by the HITL middleware before it runs.
    The human sees the proposed arguments and can approve, edit, or reject.
    Only upon approval does this function actually execute.

    Args:
        sender_user_id: The verified sender's user ID.
        recipient_id: The resolved recipient's user ID.
        amount: Transfer amount (must be > 0).
        currency: ISO currency code (default MYR).
        message: Free-text transfer message / purpose.
        tx_note: Optional internal note.
        risk_score: Agent's assessed risk score (0-100).
        reason_codes: Machine-friendly risk reason labels.
        evidence_refs: Concrete graph references backing the decision.
        assistant_text: Agent's human-readable explanation of the transfer.

    Returns:
        JSON string with the persisted transfer result.
    """
    result = submit_llm_transfer_decision_tool(
        user_id=sender_user_id,
        recipient_id=recipient_id,
        amount=amount,
        message=message,
        currency=currency,
        tx_note=tx_note,
        recipient_is_new=False,
        decision="APPROVED",
        risk_score=risk_score,
        reason_codes=reason_codes or [],
        evidence_refs=evidence_refs or [],
    )
    return json.dumps(result)


# ---------------------------------------------------------------------------
# Agent runtime
# ---------------------------------------------------------------------------

@dataclass
class MainAgentRuntime:
    agent: Any
    """Compiled LangGraph agent with interrupt_on enabled."""


# ---------------------------------------------------------------------------
# Helpers — model resolution
# ---------------------------------------------------------------------------

def _model_name(model: str, model_provider: str) -> str:
    return model if ":" in model else f"{model_provider}:{model}"


def _default_model_for_provider(model_provider: str) -> str:
    defaults = {
        "google_genai": "gemini-3.1-flash-lite-preview",
        "openai": "gpt-5-nano",
        "anthropic": "claude-3-5-haiku-latest",
    }
    return defaults.get(model_provider, "gpt-5-nano")


def _resolve_model_name(model: str, model_provider: str) -> str:
    candidate = (model or "").strip()
    if not candidate:
        candidate = _default_model_for_provider(model_provider)
    return _model_name(model=candidate, model_provider=model_provider)


def _set_provider_api_key(model_provider: str, api_key: str | None) -> None:
    if not api_key:
        return
    env_name = {
        "google_genai": "GOOGLE_API_KEY",
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
    }.get(model_provider)
    if env_name:
        os.environ[env_name] = api_key


# ---------------------------------------------------------------------------
# Helpers — user / config
# ---------------------------------------------------------------------------

def _default_user_id() -> str:
    return os.getenv("VOICE_AGENT_DEFAULT_USER_ID", "Eric Wong")


def _resolve_user_id(user_id: str | None) -> str:
    value = (user_id or "").strip()
    return value or _default_user_id()


def _build_turn_payload(text: str, user_id: str) -> dict[str, Any]:
    content = f"sender_user_id={user_id}\nuser_request={text}"
    return {"messages": [{"role": "user", "content": content}]}


def _resolve_recursion_limit() -> int:
    raw = (os.getenv("MAIN_AGENT_RECURSION_LIMIT", "100") or "").strip()
    try:
        value = int(raw)
    except ValueError:
        return 100
    return max(10, min(value, 500))


def _runtime_config(thread_id: str) -> dict[str, Any]:
    return {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": _resolve_recursion_limit(),
    }


# ---------------------------------------------------------------------------
# Helpers — response building
# ---------------------------------------------------------------------------

def _error_payload(thread_id: str, message: str) -> dict[str, Any]:
    return {
        "thread_id": thread_id,
        "result": {
            "mode": "final",
            "assistant_text": message,
            "card": None,
            "backend_status": "ERROR",
        },
        "hitl": None,
    }


def _summarize_tool_name(name: str) -> str:
    return {
        "search_contact_nodes_tool": "Looking up your contact",
        "get_user_node_info_tool": "Checking account info",
        "get_transfer_edges_info_tool": "Reviewing past transfers",
        "get_neptune_graph_overview_tool": "Running safety checks",
        "execute_transfer": "Preparing your transfer",
    }.get(name, "Processing")


def _collect_action_steps(messages: list[Any]) -> list[str]:
    """Extract human-readable step summaries from tool calls in message history."""
    steps: list[str] = []
    for message in messages:
        for tool_call in getattr(message, "tool_calls", []) or []:
            name = tool_call.get("name", "")
            summary = _summarize_tool_name(name)
            if summary not in steps:
                steps.append(summary)
    if not steps:
        steps = ["Checking your request", "Running safety checks"]
    return steps


def _extract_last_assistant_text(messages: list[Any]) -> str:
    """Return the text content of the last AIMessage in the conversation."""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            content = msg.content
            if isinstance(content, str) and content.strip():
                return content.strip()
            if isinstance(content, list):
                text_parts = [
                    part.get("text", "") if isinstance(part, dict) else str(part)
                    for part in content
                ]
                joined = " ".join(text_parts).strip()
                if joined:
                    return joined
    return ""


def _build_review_card(tool_args: dict[str, Any]) -> dict[str, Any]:
    """Build a transfer review card from the interrupted execute_transfer args."""
    risk_score = int(tool_args.get("risk_score", 0))
    reason_codes = list(tool_args.get("reason_codes") or [])
    amount = float(tool_args.get("amount", 0))
    currency = tool_args.get("currency", "MYR")
    raw_recipient = tool_args.get("recipient_id", "unknown")

    # Build a human-readable name from the recipient_id.
    recipient_name = raw_recipient
    if recipient_name.startswith("user:"):
        recipient_name = recipient_name[5:]
    recipient_name = " ".join(
        part.capitalize() for part in recipient_name.replace("-", " ").replace("_", " ").split()
    ) or "Unknown"

    # Derive decision preview from risk score for frontend display.
    if risk_score >= 70:
        decision_preview = "INTERVENTION_REQUIRED"
    elif risk_score >= 30 or reason_codes:
        decision_preview = "WARNING"
    else:
        decision_preview = "APPROVED"

    return {
        "card_type": "transfer_review",
        "title": "Confirm transfer",
        "subtitle": f"RM {amount:,.2f} to {recipient_name}",
        "amount": amount,
        "currency": currency,
        "recipient_name": recipient_name,
        "decision_preview": decision_preview,
        "risk_score": risk_score,
        "reason_codes": reason_codes,
        "evidence_refs": list(tool_args.get("evidence_refs") or []),
        "warning_id": None,
        "warning_delay_seconds": None,
        "purpose_question": "What is this transfer for?",
        "actions": [
            {"action": "approve", "warning_id": None, "label": "Approve"},
            {"action": "reject", "warning_id": None, "label": "Reject"},
        ],
    }


# ---------------------------------------------------------------------------
# Build the deep agent
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
ROLE
You are a friendly and helpful transfer assistant inside a Malaysian eWallet app.
You help users send money safely.

PRIMARY OBJECTIVE
Given a user's transfer request, look up contacts and check safety, then
call execute_transfer to send the money. Always prioritise protecting the user.
Never invent information.

INPUT CONTRACT
Each turn includes:
- sender_user_id (internal — NEVER show this to the user)
- user_request
Always treat sender_user_id as the sender identity for internal tool calls.

AVAILABLE TOOLS (internal — NEVER mention tool names to the user)
- search_contact_nodes_tool: find contacts by name
- get_user_node_info_tool: look up account details
- get_transfer_edges_info_tool: check transfer history
- get_neptune_graph_overview_tool: run broader safety checks
- execute_transfer: send the money (paused for user approval)

TOOL USAGE POLICY
1) Recipient resolution:
   - ALWAYS search contacts when any recipient name is mentioned.
   - Pick the BEST matching contact automatically. Do NOT ask the user to choose.
   - If no match is found, use the name as-is and proceed anyway.
2) Before calling execute_transfer:
   - Look up sender account info.
   - Look up recipient account info.
   - Check transfer history between them.
3) ALWAYS call execute_transfer as soon as evidence is gathered.
   The system will show a review screen where the user can approve or reject.
   Do NOT ask the user to confirm before calling execute_transfer — that is
   what the review screen is for.

IMPORTANT: NEVER ask follow-up questions if the user has given a recipient
and an amount. Go straight to investigation and execute_transfer.
Only ask if the user's message has NO recipient AND NO amount at all
(e.g. just "send money" with nothing else).

INCOMPLETE REQUEST POLICY
- If greeting ("hi", "hello"), reply warmly and ask what they'd like to send.
- Only ask if BOTH recipient and amount are completely missing.
- If you have at least a recipient OR an amount, proceed with what you have
  and use sensible defaults. The HITL review screen will catch any issues.

RISK ASSESSMENT (internal — simplified for user)
When calling execute_transfer, set:
- risk_score: 0-100
- reason_codes: machine labels (user never sees these)
- evidence_refs: internal references (user never sees these)
- assistant_text: a SHORT, friendly summary for the user
  Example: "Sending RM 15 to Ali for lunch. Looks safe!"
  Example: "This is a large transfer to someone you haven't paid before.
            Please double-check before confirming."

COMMUNICATION STYLE — MANDATORY
- Use short, simple sentences a non-technical person can understand.
- NEVER expose: user_id, node, edge, graph, tool names, reason_codes,
  evidence_refs, risk_score numbers, internal system details.
- NEVER say "user node", "transfer edge", "graph", "execute_transfer",
  "search_contact_nodes_tool", or any internal term.
- Keep responses under 3 sentences when possible.
- Use a warm, reassuring tone.
"""


def build_main_deep_agent(
    model: str,
    model_provider: str = "google_genai",
    api_key: str | None = None,
    checkpointer: Any | None = None,
) -> MainAgentRuntime:
    """Create the main transaction agent with interrupt_on HITL."""
    _set_provider_api_key(model_provider=model_provider, api_key=api_key)
    deep_agent = create_agent(
        model=_resolve_model_name(model=model, model_provider=model_provider),
        tools=[
            # Read-only graph query tools (auto-approved).
            search_contact_nodes_tool,
            get_user_node_info_tool,
            get_transfer_edges_info_tool,
            get_neptune_graph_overview_tool,
            # Action tool — gated by interrupt_on.
            execute_transfer,
        ],
        middleware=[
                HumanInTheLoopMiddleware(
                interrupt_on={
                    "execute_transfer": {
                        "allowed_decisions": ["approve", "reject"],
                    },
                },
            ),
        ],
        checkpointer=checkpointer or MemorySaver(),
        system_prompt=SYSTEM_PROMPT,
        debug=True,
    )
    return MainAgentRuntime(agent=deep_agent)


# ---------------------------------------------------------------------------
# Run a turn — detect interrupts for HITL
# ---------------------------------------------------------------------------

def run_main_turn(
    agent: MainAgentRuntime,
    text: str,
    thread_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Run a single user turn through the agent.

    If the agent calls ``execute_transfer``, the graph pauses (interrupt_on)
    and this function returns a ``hitl_required`` response with a review card
    built from the tool call arguments.

    If no transfer tool is called (e.g. a greeting or follow-up question),
    the graph completes normally and a ``final`` response is returned.
    """
    resolved_thread_id = thread_id or str(uuid.uuid4())
    resolved_user_id = _resolve_user_id(user_id)
    config = _runtime_config(resolved_thread_id)

    try:
        agent.agent.invoke(
            _build_turn_payload(text=text, user_id=resolved_user_id),
            config=config,
        )
    except GraphRecursionError:
        return _error_payload(
            resolved_thread_id,
            "Request took too many reasoning steps. "
            "Please rephrase with transfer details (recipient and amount).",
        )
    except Exception as exc:  # noqa: BLE001
        return _error_payload(
            resolved_thread_id,
            f"Unable to process transfer request: {exc}",
        )

    # Check whether the graph paused at execute_transfer.
    return _build_response_from_state(agent, resolved_thread_id, config)


def _build_response_from_state(
    agent: MainAgentRuntime,
    thread_id: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Inspect the graph state and return the appropriate response payload."""
    state = agent.agent.get_state(config)
    messages = state.values.get("messages", [])
    steps = _collect_action_steps(messages)

    # --- Interrupted → HITL required ----------------------------------
    if state.tasks:
        for task in state.tasks:
            for intr in task.interrupts:
                interrupt_value = intr.value
                # The HumanInTheLoopMiddleware wraps the interrupt as a
                # HITLRequest dict with action_requests / review_configs.
                tool_args = _extract_tool_args_from_interrupt(
                    interrupt_value, messages
                )
                if tool_args is not None:
                    assistant_text = (
                        tool_args.get("assistant_text", "").strip()
                        or _extract_last_assistant_text(messages)
                        or "Please review and approve this transfer."
                    )
                    return {
                        "thread_id": thread_id,
                        "result": {
                            "mode": "hitl_required",
                            "assistant_text": assistant_text,
                            "card": _build_review_card(tool_args),
                            "backend_status": "HITL_REQUIRED",
                            "steps": steps,
                        },
                        "hitl": {"state": "pending"},
                    }

    # --- No interrupt → final response --------------------------------
    assistant_text = (
        _extract_last_assistant_text(messages)
        or "Transfer complete."
    )

    # Determine backend status based on whether execute_transfer ran.
    has_transfer_result = any(
        getattr(m, "name", None) == "execute_transfer"
        for m in messages
        if not isinstance(m, AIMessage)
    )
    backend_status = "APPROVED" if has_transfer_result else "NEED_MORE_INFO"

    return {
        "thread_id": thread_id,
        "result": {
            "mode": "final",
            "assistant_text": assistant_text,
            "card": None,
            "backend_status": backend_status,
            "steps": steps,
        },
        "hitl": None,
    }


def _extract_tool_args_from_interrupt(
    interrupt_value: Any, messages: list[Any]
) -> dict[str, Any] | None:
    """Extract execute_transfer args from the HITL interrupt payload.

    The ``HumanInTheLoopMiddleware`` wraps interrupts as a dict with
    ``action_requests`` — each containing ``name`` and ``args``.  We look
    for the ``execute_transfer`` action and return its args.

    Falls back to extracting from the last AIMessage tool_calls if the
    interrupt structure is unrecognised.
    """
    # Standard HITLRequest structure from HumanInTheLoopMiddleware.
    if isinstance(interrupt_value, dict):
        for action in interrupt_value.get("action_requests", []):
            if isinstance(action, dict) and action.get("name") == "execute_transfer":
                return action.get("args", {})

    # Fallback: extract from the last AI message's tool_calls.
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            for tc in msg.tool_calls or []:
                if tc.get("name") == "execute_transfer":
                    return tc.get("args", {})
            break

    return None


# ---------------------------------------------------------------------------
# Resume after HITL decision
# ---------------------------------------------------------------------------

def resume_main_hitl(
    agent: MainAgentRuntime,
    thread_id: str,
    decision: str,
    warning_id: str | None = None,
    purpose: str | None = None,
) -> dict[str, Any]:
    """Resume the paused graph after a human approve/reject decision.

    Uses ``Command(resume=...)`` with the ``HumanInTheLoopMiddleware``
    decision format to either execute the transfer or reject it.
    """
    config = _runtime_config(thread_id)

    # Verify there's actually a pending interrupt.
    state = agent.agent.get_state(config)
    if not state.tasks:
        return _error_payload(thread_id, "No pending transfer decision for this thread.")

    if decision == "approve":
        resume_value = {"decisions": [{"type": "approve"}]}
    else:
        reject_msg = "User rejected the transfer."
        if purpose:
            reject_msg = f"User rejected the transfer. Reason: {purpose}"
        resume_value = {
            "decisions": [{"type": "reject", "message": reject_msg}],
        }

    try:
        agent.agent.invoke(Command(resume=resume_value), config=config)
    except GraphRecursionError:
        return _error_payload(thread_id, "Transfer processing exceeded step limit.")
    except Exception as exc:  # noqa: BLE001
        return _error_payload(thread_id, f"Unable to process decision: {exc}")

    return _build_response_from_state(agent, thread_id, config)


# ---------------------------------------------------------------------------
# Streaming wrapper
# ---------------------------------------------------------------------------

def run_main_turn_stream_events(
    agent: MainAgentRuntime,
    text: str,
    thread_id: str | None = None,
    user_id: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    """Yield SSE-compatible events for a single user turn."""
    resolved_thread_id = thread_id or str(uuid.uuid4())
    yield {"event": "step", "summary": "Checking your request"}
    yield {"event": "step", "summary": "Running safety checks"}
    result = run_main_turn(
        agent=agent,
        text=text,
        thread_id=resolved_thread_id,
        user_id=user_id,
    )
    yield {"event": "final", "payload": result}
