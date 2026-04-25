import os
import uuid
from dataclasses import dataclass, field
from collections.abc import Generator
from typing import Any, Literal

from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel, Field

from transaction_agent.graph_tools import (
    get_transfer_edges_info_tool,
    get_user_node_info_tool,
    search_contact_nodes_tool,
)
from transaction_agent.tools import confirm_warning_tool, submit_llm_transfer_decision_tool


class LLMTransferDecision(BaseModel):
    mode: Literal["transfer_decision", "message"] = "message"
    assistant_text: str
    card_type: Literal["none", "transfer_review"] = "none"
    recipient_query: str | None = None
    recipient_id: str | None = None
    amount: float | None = Field(default=None, gt=0)
    currency: str = "MYR"
    message: str = ""
    tx_note: str | None = None
    decision: Literal["APPROVED", "WARNING", "INTERVENTION_REQUIRED"] | None = None
    risk_score: int = Field(default=0, ge=0, le=100)
    reason_codes: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    purpose_question: str = "What is this transaction for?"


@dataclass
class PendingDecision:
    warning_id: str
    decision: str
    transfer: dict[str, Any] = field(default_factory=dict)


@dataclass
class MainAgentRuntime:
    agent: Any
    pending_by_thread: dict[str, PendingDecision] = field(default_factory=dict)


def _model_name(model: str, model_provider: str) -> str:
    return model if ":" in model else f"{model_provider}:{model}"


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


def _default_user_id() -> str:
    return os.getenv("VOICE_AGENT_DEFAULT_USER_ID", "marcus")


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


def _build_review_card(result: dict[str, Any]) -> dict[str, Any]:
    decision = result.get("decision", "WARNING")
    warning_id = result.get("warning_id")
    return {
        "card_type": "transfer_review",
        "title": "Review transfer risk",
        "subtitle": "Please approve or reject this transfer.",
        "decision_preview": decision,
        "risk_score": int(result.get("risk_score", 0)),
        "reason_codes": list(result.get("reason_codes", [])),
        "evidence_refs": list(result.get("evidence_refs", [])),
        "warning_id": warning_id,
        "warning_delay_seconds": result.get("warning_delay_seconds"),
        "purpose_question": result.get("purpose_question", "What is this transaction for?"),
        "actions": [
            {"action": "approve", "warning_id": warning_id, "label": "Approve"},
            {"action": "reject", "warning_id": warning_id, "label": "Reject"},
        ],
    }


def _decision_from_result(result: dict[str, Any]) -> LLMTransferDecision:
    raw = result.get("structured_response")
    if raw is None:
        raise ValueError("missing_structured_response")
    if isinstance(raw, LLMTransferDecision):
        return raw
    if isinstance(raw, dict):
        return LLMTransferDecision.model_validate(raw)
    if isinstance(raw, BaseModel):
        return LLMTransferDecision.model_validate(raw.model_dump())
    raise ValueError("invalid_structured_response")


def _summarize_tool_name(name: str) -> str:
    return {
        "search_contact_nodes_tool": "Finding matching contacts",
        "get_user_node_info_tool": "Checking user node details",
        "get_transfer_edges_info_tool": "Checking transfer edge history",
    }.get(name, f"Running {name}")


def _collect_action_steps(result: dict[str, Any]) -> list[str]:
    steps: list[str] = []
    for message in result.get("messages", []):
        for tool_call in getattr(message, "tool_calls", []) or []:
            name = tool_call.get("name", "")
            summary = _summarize_tool_name(name)
            if summary not in steps:
                steps.append(summary)
    if not steps:
        steps = ["Analysing transfer request", "Checking fraud risk"]
    return steps


def _response_from_agent_decision(
    agent: MainAgentRuntime,
    agent_decision: LLMTransferDecision,
    steps: list[str],
    source_text: str,
    thread_id: str,
) -> dict[str, Any]:
    if agent_decision.mode != "transfer_decision":
        return {
            "thread_id": thread_id,
            "result": {
                "mode": "final",
                "assistant_text": agent_decision.assistant_text,
                "card": None,
                "backend_status": "NEED_MORE_INFO",
                "steps": steps,
            },
            "hitl": None,
        }

    if agent_decision.amount is None or not agent_decision.recipient_id or agent_decision.decision is None:
        return {
            "thread_id": thread_id,
            "result": {
                "mode": "final",
                "assistant_text": agent_decision.assistant_text or "Who do you want to transfer to, and how much?",
                "card": None,
                "backend_status": "NEED_MORE_INFO",
                "steps": steps,
            },
            "hitl": None,
        }

    try:
        risk_result = submit_llm_transfer_decision_tool(
            user_id=_default_user_id(),
            recipient_id=agent_decision.recipient_id,
            amount=float(agent_decision.amount),
            message=agent_decision.message or source_text,
            currency=agent_decision.currency or "MYR",
            tx_note=agent_decision.tx_note,
            recipient_is_new=False,
            decision=agent_decision.decision,
            risk_score=agent_decision.risk_score,
            reason_codes=agent_decision.reason_codes,
            evidence_refs=agent_decision.evidence_refs,
        )
    except Exception as exc:  # noqa: BLE001
        return _error_payload(thread_id, f"Unable to persist transfer decision right now: {exc}")

    persisted_decision = str(risk_result.get("decision", "WARNING"))
    warning_id = risk_result.get("warning_id")
    if persisted_decision in {"WARNING", "INTERVENTION_REQUIRED"} and isinstance(warning_id, str):
        risk_result["purpose_question"] = agent_decision.purpose_question
        agent.pending_by_thread[thread_id] = PendingDecision(
            warning_id=warning_id,
            decision=persisted_decision,
            transfer={
                "recipient_id": agent_decision.recipient_id,
                "amount": agent_decision.amount,
                "currency": agent_decision.currency,
                "message": agent_decision.message,
            },
        )
        return {
            "thread_id": thread_id,
            "result": {
                "mode": "hitl_required",
                "assistant_text": agent_decision.assistant_text or "Risk detected. Please approve or reject this transfer.",
                "card": _build_review_card(risk_result),
                "backend_status": "HITL_REQUIRED",
                "steps": steps,
            },
            "hitl": {
                "state": "pending",
                "decision_preview": persisted_decision,
                "warning_id": warning_id,
            },
        }

    if isinstance(warning_id, str):
        try:
            backend_status = confirm_warning_tool(warning_id=warning_id, confirmed=True).get(
                "status",
                "APPROVED",
            )
        except Exception as exc:  # noqa: BLE001
            return _error_payload(thread_id, f"Transfer risk checked but finalize step failed: {exc}")
    else:
        backend_status = "APPROVED"

    assistant_text = agent_decision.assistant_text.strip() or "Transfer approved."
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


def build_main_deep_agent(
    model: str,
    model_provider: str = "google_genai",
    api_key: str | None = None,
) -> MainAgentRuntime:
    _set_provider_api_key(model_provider=model_provider, api_key=api_key)
    deep_agent = create_deep_agent(
        model=_model_name(model=model, model_provider=model_provider),
        tools=[
            search_contact_nodes_tool,
            get_user_node_info_tool,
            get_transfer_edges_info_tool,
        ],
        response_format=LLMTransferDecision,
        checkpointer=MemorySaver(),
        system_prompt=(
            "You are an LLM-based transaction fraud reasoning agent for wallet transfers. "
            "Do not use fixed scoring rules, threshold formulas, or keyword heuristics. "
            "Use the available graph tools dynamically and base your decision on the evidence they return. "
            "The graph schema is exactly: User node (:User) with fields ~id, ekyc_status, ekyc_level, "
            "hashed_phone, hashed_ic, risk_tier_current, summary_text_latest, summary_updated_at, "
            "summary_agent_version, created_at, updated_at; and transaction edge "
            "(:User)-[:TRANSFERRED_TO]->(:User) with fields ~id, tx_time, amount, currency, "
            "message_text, tx_note, channel, status, finbert_score, emotion_score, risk_score_latest, "
            "risk_reason_codes, updated_at. "
            "For any transfer request, extract recipient, amount, currency, and message/purpose. "
            "Call search_contact_nodes_tool when the recipient is named or ambiguous. "
            "Call get_user_node_info_tool for the sender and recipient before deciding. "
            "Call get_transfer_edges_info_tool for sender-to-recipient edge history before deciding. "
            "If you cannot identify a transfer or required details are missing, return mode='message' "
            "with a concise assistant_text asking only for the missing information. "
            "If the transfer is clear, return mode='transfer_decision', recipient_id, amount, currency, "
            "decision, risk_score, reason_codes, evidence_refs, and assistant_text. "
            "Use decision APPROVED only when the evidence looks normal; WARNING for suspicious but user-resolvable "
            "risk; INTERVENTION_REQUIRED for high confidence fraud indicators. "
            "When decision is WARNING or INTERVENTION_REQUIRED, set card_type='transfer_review' and ask "
            "'What is this transaction for?' through purpose_question. "
            "Reason from graph/user/edge facts and uncertainty. Never mention hidden rules."
        ),
    )
    return MainAgentRuntime(agent=deep_agent)


def run_main_turn(agent: MainAgentRuntime, text: str, thread_id: str | None = None) -> dict[str, Any]:
    resolved_thread_id = thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": resolved_thread_id}}

    try:
        llm_result = agent.agent.invoke(
            {"messages": [{"role": "user", "content": text}]},
            config=config,
            version="v2",
        )
        agent_decision = _decision_from_result(llm_result)
        steps = _collect_action_steps(llm_result)
    except Exception as exc:  # noqa: BLE001
        return _error_payload(resolved_thread_id, f"Unable to parse transfer intent: {exc}")

    return _response_from_agent_decision(
        agent=agent,
        agent_decision=agent_decision,
        steps=steps,
        source_text=text,
        thread_id=resolved_thread_id,
    )


def run_main_turn_stream_events(
    agent: MainAgentRuntime,
    text: str,
    thread_id: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    resolved_thread_id = thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": resolved_thread_id}}
    llm_result: dict[str, Any] = {}
    steps: list[str] = []

    def emit_step(summary: str) -> dict[str, Any] | None:
        if summary in steps:
            return None
        steps.append(summary)
        return {"event": "step", "summary": summary}

    first = emit_step("Analysing transfer request")
    if first:
        yield first

    try:
        for chunk in agent.agent.stream(
            {"messages": [{"role": "user", "content": text}]},
            config=config,
            stream_mode=["updates", "custom"],
            subgraphs=True,
            version="v2",
        ):
            chunk_type = chunk.get("type")
            data = chunk.get("data")
            if chunk_type == "custom" and isinstance(data, dict):
                detail = data.get("detail") or data.get("status")
                if isinstance(detail, str):
                    event = emit_step(detail)
                    if event:
                        yield event
                continue

            if chunk_type != "updates" or not isinstance(data, dict):
                continue

            for node_name, update in data.items():
                if node_name == "tools":
                    event = emit_step("Checking graph evidence")
                    if event:
                        yield event
                elif node_name == "model_request":
                    event = emit_step("Reasoning over graph signals")
                    if event:
                        yield event
                if isinstance(update, dict):
                    llm_result.update(update)

        if "structured_response" not in llm_result and hasattr(agent.agent, "get_state"):
            state = agent.agent.get_state(config)
            values = getattr(state, "values", None)
            if isinstance(values, dict):
                llm_result.update(values)

        agent_decision = _decision_from_result(llm_result)
        if not any(step.startswith("Finding") or step.startswith("Checking") for step in steps):
            steps.extend(_collect_action_steps(llm_result))
        result = _response_from_agent_decision(
            agent=agent,
            agent_decision=agent_decision,
            steps=steps,
            source_text=text,
            thread_id=resolved_thread_id,
        )
    except Exception as exc:  # noqa: BLE001
        result = _error_payload(resolved_thread_id, f"Unable to parse transfer intent: {exc}")

    yield {"event": "final", "payload": result}


def resume_main_hitl(agent: MainAgentRuntime, thread_id: str, decision: str, purpose: str | None = None) -> dict[str, Any]:
    pending = agent.pending_by_thread.get(thread_id)
    if pending is None:
        return _error_payload(thread_id, "No pending transfer decision for this thread.")
    if purpose:
        pending.transfer["user_purpose"] = purpose

    should_confirm = decision == "approve"
    try:
        result = confirm_warning_tool(warning_id=pending.warning_id, confirmed=should_confirm)
    except Exception as exc:  # noqa: BLE001
        return _error_payload(thread_id, f"Unable to process decision right now: {exc}")

    backend_status = str(result.get("status", "ERROR"))
    if backend_status != "PENDING_DELAY":
        agent.pending_by_thread.pop(thread_id, None)

    wait_seconds_remaining = result.get("wait_seconds_remaining")
    if backend_status == "PENDING_DELAY":
        wait_text = f" Please wait {wait_seconds_remaining}s and try again." if wait_seconds_remaining is not None else ""
        return {
            "thread_id": thread_id,
            "result": {
                "mode": "hitl_required",
                "assistant_text": f"Cooling-off delay is still active.{wait_text}",
                "card": {
                    "card_type": "transfer_review",
                    "title": "Cooling-off delay active",
                    "subtitle": "You can retry approval after the delay.",
                    "decision_preview": pending.decision,
                    "risk_score": 0,
                    "reason_codes": [],
                    "evidence_refs": [],
                    "warning_id": pending.warning_id,
                    "warning_delay_seconds": wait_seconds_remaining,
                    "actions": [
                        {"action": "approve", "warning_id": pending.warning_id, "label": "Approve"},
                        {"action": "reject", "warning_id": pending.warning_id, "label": "Reject"},
                    ],
                },
                "backend_status": backend_status,
            },
            "hitl": {"state": "pending", "warning_id": pending.warning_id},
        }

    assistant_text = "Transfer approved." if should_confirm else "Transfer cancelled."
    return {
        "thread_id": thread_id,
        "result": {
            "mode": "final",
            "assistant_text": assistant_text,
            "card": None,
            "backend_status": backend_status,
        },
        "hitl": None,
    }
