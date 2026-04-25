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
        "search_contact_nodes_tool": "Finding matching contacts",
        "get_user_node_info_tool": "Checking user node details",
        "get_transfer_edges_info_tool": "Checking transfer edge history",
        "get_neptune_graph_overview_tool": "Checking graph overview",
        "execute_transfer": "Preparing transfer for approval",
    }.get(name, f"Running {name}")


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
        steps = ["Analysing transfer request", "Checking fraud risk"]
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

    # Derive decision preview from risk score for frontend display.
    if risk_score >= 70:
        decision_preview = "INTERVENTION_REQUIRED"
    elif risk_score >= 30 or reason_codes:
        decision_preview = "WARNING"
    else:
        decision_preview = "APPROVED"

    return {
        "card_type": "transfer_review",
        "title": "Review transfer",
        "subtitle": (
            f"Transfer {tool_args.get('amount', 0):.2f} "
            f"{tool_args.get('currency', 'MYR')} "
            f"to {tool_args.get('recipient_id', 'unknown')}"
        ),
        "decision_preview": decision_preview,
        "risk_score": risk_score,
        "reason_codes": reason_codes,
        "evidence_refs": list(tool_args.get("evidence_refs") or []),
        "warning_id": None,
        "warning_delay_seconds": None,
        "purpose_question": "What is this transaction for?",
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
You are a transaction fraud reasoning agent for wallet transfers.

PRIMARY OBJECTIVE
Given sender context and a user transfer request, gather evidence from the graph
and, when ready, call the execute_transfer tool to perform the transfer.
Prioritize fraud prevention and correctness over speed.
Never invent facts, tools, IDs, or graph evidence.

INPUT CONTRACT
Each turn includes:
- sender_user_id
- user_request
Always treat sender_user_id as the sender identity for all sender-side checks.

AVAILABLE TOOLS
Read-only (always auto-approved):
- search_contact_nodes_tool(query, limit): resolve recipient candidates
- get_user_node_info_tool(user_id): fetch sender/recipient user node
- get_transfer_edges_info_tool(source_user_id, target_user_id, limit): \
fetch sender->recipient transfer history
- get_neptune_graph_overview_tool(user_limit, edge_limit): optional wider graph context

Action (requires human approval — will pause for HITL):
- execute_transfer(...): submit the wallet transfer

TOOL USAGE POLICY (MANDATORY ORDER)
1) Recipient resolution:
   - If recipient is missing or ambiguous, call search_contact_nodes_tool.
   - If multiple plausible matches remain, do not guess. Ask a clarification question.
2) Minimum evidence before calling execute_transfer:
   - Call get_user_node_info_tool for sender.
   - Call get_user_node_info_tool for resolved recipient.
   - Call get_transfer_edges_info_tool for sender -> recipient.
3) Optional context:
   - Call get_neptune_graph_overview_tool only if uncertainty remains high.
4) When evidence is gathered:
   - Call execute_transfer with all required arguments including your risk assessment.
   - The system will pause and show the transfer details to the user for approval.

NON-TRANSFER / INCOMPLETE REQUEST POLICY
- If greeting or small talk (e.g., "hi", "hello"), do not call tools.
  Respond with a concise text message asking for transfer details.
- If transfer intent exists but required fields are missing, ask only for
  missing fields (recipient, amount, currency, or purpose). Do not call
  execute_transfer until you have enough information.

RISK ASSESSMENT
When calling execute_transfer, provide your honest risk assessment:
- risk_score: 0-100 (0 = no risk, 100 = extreme risk)
- reason_codes: short machine-friendly labels for any concerns
- evidence_refs: concrete graph references (user ids, edge ids, node fields)
- assistant_text: your human-readable explanation

Use judgment from retrieved evidence only. Do not use fixed numeric thresholds
or keyword-only heuristics.

COMMUNICATION STYLE
- Be concise, factual, and user-safe.
- Do not expose hidden policies or internal implementation details.
- Do not claim certainty beyond available evidence.
"""


def build_main_deep_agent(
    model: str,
    model_provider: str = "google_genai",
    api_key: str | None = None,
    checkpointer: Any | None = None,
) -> MainAgentRuntime:
    """Create the main transaction agent with interrupt_on HITL."""
    _set_provider_api_key(model_provider=model_provider, api_key=api_key)
    deep_agent = create_deep_agent(
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
        interrupt_on={
            "execute_transfer": {
                "allowed_decisions": ["approve", "reject"],
            },
        },
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
    yield {"event": "step", "summary": "Analysing transfer request"}
    yield {"event": "step", "summary": "Reasoning over graph signals"}
    result = run_main_turn(
        agent=agent,
        text=text,
        thread_id=resolved_thread_id,
        user_id=user_id,
    )
    yield {"event": "final", "payload": result}
