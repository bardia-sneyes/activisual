"""Hermes plugin adapter for Activisual."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SENSITIVE = re.compile(r"(?:^|_)(?:api[_-]?key|authorization|cookie|credential|passwd|password|private[_-]?key|secret|session[_-]?token|token)(?:$|_)", re.I)
_ASSIGNMENT = re.compile(r"\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s]+)", re.I)


def _safe_id(value: Any) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", str(value or "unknown"))[:180]


def _redact(value: Any, depth: int = 0) -> Any:
    if depth > 7:
        return "[depth limit]"
    if isinstance(value, str):
        text = _ASSIGNMENT.sub(r"\1=[redacted]", value)
        text = re.sub(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", text, flags=re.I)
        return text[:12000] + ("\n… [truncated]" if len(text) > 12000 else "")
    if isinstance(value, list):
        return [_redact(item, depth + 1) for item in value[:50]]
    if isinstance(value, dict):
        return {key: "[redacted]" if _SENSITIVE.search(key) else _redact(child, depth + 1) for key, child in value.items()}
    return value


def _write(event: str, **payload: Any) -> None:
    try:
        cwd = Path(payload.pop("cwd", None) or os.getcwd()).resolve()
        data_dir = cwd / ".activisual"
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        record = {
            "id": str(uuid.uuid4()),
            "receivedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sessionId": _safe_id(payload.pop("session_id", "unknown")),
            "turnId": _safe_id(payload.pop("turn_id")) if payload.get("turn_id") else None,
            "event": event,
            "cwd": str(cwd),
            "model": payload.pop("model", None),
            "permissionMode": None,
            **_redact(payload),
        }
        with (data_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as error:  # Observability must never block Hermes.
        if os.getenv("ACTIVISUAL_DEBUG") == "1":
            print(f"activisual hook: {error}", file=__import__("sys").stderr)


def _session_start(session_id: str, model: str | None = None, **kwargs: Any) -> None:
    _write("SessionStart", session_id=session_id, model=model, source=kwargs.get("platform", "startup"))


def _prompt(session_id: str, user_message: str = "", turn_id: str | None = None, model: str | None = None, **kwargs: Any) -> None:
    _write("UserPromptSubmit", session_id=session_id, turn_id=turn_id, model=model, prompt=user_message)


def _pre_tool(tool_name: str, args: Any, task_id: str = "", **kwargs: Any) -> None:
    session_id = kwargs.get("session_id") or task_id
    _write("PreToolUse", session_id=session_id, turn_id=kwargs.get("turn_id"), toolName=tool_name, toolUseId=_safe_id(kwargs.get("tool_call_id")), toolInput=args)


def _post_tool(tool_name: str, args: Any, result: Any, task_id: str = "", **kwargs: Any) -> None:
    session_id = kwargs.get("session_id") or task_id
    response = {"result": result, "status": kwargs.get("status"), "error": kwargs.get("error_message")}
    _write("PostToolUse", session_id=session_id, turn_id=kwargs.get("turn_id"), toolName=tool_name, toolUseId=_safe_id(kwargs.get("tool_call_id")), toolInput=args, toolResponse=response)


def _approval(command: str, description: str, session_key: str, **kwargs: Any) -> None:
    _write("PermissionRequest", session_id=session_key, toolName="terminal", toolInput={"command": command, "description": description, "surface": kwargs.get("surface")})


def _turn_end(session_id: str, turn_id: str | None = None, model: str | None = None, **kwargs: Any) -> None:
    _write("Stop", session_id=session_id, turn_id=turn_id, model=model, completed=kwargs.get("completed"), interrupted=kwargs.get("interrupted"))


def _finalize(session_id: str | None = None, platform: str | None = None, **kwargs: Any) -> None:
    _write("SessionEnd", session_id=session_id, reason=kwargs.get("reason", platform or "other"))


def _subagent_start(parent_session_id: str | None = None, parent_turn_id: str | None = None, child_session_id: str | None = None, child_subagent_id: str | None = None, child_role: str | None = None, child_goal: str | None = None, **kwargs: Any) -> None:
    _write("SubagentStart", session_id=parent_session_id, turn_id=parent_turn_id, agentId=_safe_id(child_subagent_id or child_session_id), agentType=child_role or "subagent", goal=child_goal)


def _subagent_stop(parent_session_id: str | None = None, child_role: str | None = None, child_summary: str | None = None, child_status: str | None = None, **kwargs: Any) -> None:
    _write("SubagentStop", session_id=parent_session_id, turn_id=kwargs.get("parent_turn_id"), agentId=_safe_id(kwargs.get("child_subagent_id") or kwargs.get("child_session_id")), agentType=child_role or "subagent", summary=child_summary, status=child_status, durationMs=kwargs.get("duration_ms"))


def register(ctx: Any) -> None:
    ctx.register_hook("on_session_start", _session_start)
    ctx.register_hook("pre_llm_call", _prompt)
    ctx.register_hook("pre_tool_call", _pre_tool)
    ctx.register_hook("post_tool_call", _post_tool)
    ctx.register_hook("pre_approval_request", _approval)
    ctx.register_hook("on_session_end", _turn_end)
    ctx.register_hook("on_session_finalize", _finalize)
    ctx.register_hook("subagent_start", _subagent_start)
    ctx.register_hook("subagent_stop", _subagent_stop)
