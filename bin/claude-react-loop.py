#!/usr/bin/env python3
"""
ReAct loop for claude-shim — portable version
Full Gatehouse MCP tool use for shim agents.

Original hardcoded ~[old-ranch-path] paths and gatehouse config.
This version is portable: uses env vars, falls back gracefully if gatehouse not present.

The nim-shim-real binary is prompt->text only with zero tool capability.
This wrapper implements a ReAct loop:
1. Fetch live Gatehouse tool catalog (if available) and inject as instructions
2. Call model via nim-shim-real
3. Parse <tool_call> tags
4. Execute via Gatehouse CLI
5. Loop until model answers without tool tags

Durability:
- Bounded deadlines - subprocesses and HTTP calls fail fast on a deadline
- Catalog fetched live at startup
- Iteration ceiling 25 (Corral default maxIterations)
"""

import collections
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Configurable via env
GATEHOUSE_BIN = os.environ.get("GATEHOUSE_BIN", "gatehouse")
GATEHOUSE_CONFIG = os.environ.get(
    "GATEHOUSE_CONFIG",
    str(Path.home() / ".config" / "corral" / "gatehouse" / "mcp_config.json")
)
NIM_SHIM_REAL = os.environ.get(
    "CLAUDE_REAL_BIN",
    str(Path.home() / ".local" / "bin" / "claude.nim-shim-real")
)
MAX_ITERATIONS = int(os.environ.get("CORRAL_REACT_MAX_ITER", "25"))
HTTP_DEADLINE_S = int(os.environ.get("CORRAL_REACT_HTTP_DEADLINE_S", "60"))
MAX_RESULT_CHARS = 6000

_WRITE_TOKENS = (
    "write", "create", "update", "put", "patch", "set", "add", "push",
    "merge", "copy", "move", "rename", "index", "ingest", "execute",
    "run", "launch", "publish", "hset", "xadd", "convert", "refactor",
    "replace", "extract", "type", "click", "press", "drag", "scroll",
)
_DESTRUCTIVE_TOKENS = ("delete", "remove", "destroy", "drop", "truncate", "kill")


def run(cmd, timeout=60):
    """Run command with timeout. Returns None on timeout."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def fetch_catalog():
    """Return live gatehouse tool catalog, or empty if not available."""
    try:
        r = run([GATEHOUSE_BIN, "tools", "list", "-c", GATEHOUSE_CONFIG, "-o", "json"], timeout=10)
        if r is None:
            return []
        data = json.loads(r.stdout)
        if isinstance(data, dict):
            data = data.get("tools", [])
        return data
    except Exception:
        return []


def compact_catalog(catalog):
    if not catalog:
        return "(no gatehouse catalog available — running in prompt-only mode)"
    grouped = collections.defaultdict(list)
    for t in catalog:
        name = t.get("name", "")
        server = t.get("server_name", "")
        if server and name:
            grouped[server].append(name)
    lines = []
    for server in sorted(grouped):
        lines.append("%s: %s" % (server, ", ".join(sorted(grouped[server]))))
    return "\n".join(lines)


def full_catalog(catalog):
    lines = []
    for t in sorted(catalog, key=lambda x: (x.get("server_name", ""), x.get("name", ""))):
        lines.append(
            "%s:%s - %s"
            % (t.get("server_name"), t.get("name"), (t.get("description") or "")[:160])
        )
    return "\n".join(lines)


def tool_schema(catalog, server, name):
    for t in catalog:
        if t.get("server_name") == server and t.get("name") == name:
            return json.dumps(
                {
                    "server": server,
                    "name": name,
                    "description": t.get("description"),
                    "schema": t.get("schema"),
                },
                indent=2,
            )[:4000]
    return "Tool %s:%s not found in catalog." % (server, name)


def build_instructions(catalog):
    if not catalog:
        return "You are a coding agent. Answer the task directly."

    return """You have full tool access through the Gatehouse MCP proxy.
To use a tool, output EXACTLY this format:

<tool_call>
{"server": "<server>", "tool": "<tool>", "arguments": {<args as JSON object>}}
</tool_call>

TOOL CATALOG (server: tools):
%s

Special discovery tools:
- {"server": "gatehouse", "tool": "catalog"} returns every tool with description
- {"server": "gatehouse", "tool": "describe", "arguments": {"server": "<server>", "tool": "<tool>"}} returns schema

CRITICAL RULES:
- When task requires file operations, you MUST output <tool_call> tag. Narrating without calling is failure.
- Call gatehouse:describe first when unsure of args.
- Output ONLY tool_call tag when using tool.
- After result, continue or give final answer without tags.
""" % compact_catalog(catalog)


def call_model(prompt):
    """Call nim-shim-real (prompt via stdin), with fallback to direct API call."""
    try:
        result = subprocess.run([NIM_SHIM_REAL], input=prompt,
                                capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        result = None
    out = (result.stdout.strip() if result else "")
    if out:
        return out
    return direct_model_call(prompt)


def direct_model_call(prompt):
    """Direct OpenAI-compatible chat call; merges content and reasoning."""
    import urllib.request

    # 2026-10-18: hodos flock :25193 is the master router (:25104 was the
    # retired nim-proxy port). Key resolution: FLOCK_API_KEY ->
    # NIM_PROXY_API_KEY -> flock client-key files -> NVIDIA_API_KEY last.
    # The flock CLIENT key is the right credential on any flock base URL;
    # NVIDIA_API_KEY is an upstream nvapi key and only a last resort.
    base = os.environ.get("NIM_BASE_URL", "http://127.0.0.1:25193/v1").rstrip("/")
    key = os.environ.get("FLOCK_API_KEY", "")
    if not key:
        key = os.environ.get("NIM_PROXY_API_KEY", "")
    if not key:
        for ck in ("~/.hodos-data/client-key.corral", "~/.flock/client-key.corral", "~/.flock-data/client-key.corral"):
            try:
                p = os.path.expanduser(ck)
                if os.path.exists(p):
                    key = open(p).read().strip()
                    if key:
                        break
            except Exception:
                pass
    if not key:
        key = os.environ.get("NVIDIA_API_KEY", "")
    model = os.environ.get("NIM_MODEL", "")
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8192,
        "temperature": 1,
        "top_p": 0.95,
    }).encode()
    req = urllib.request.Request(
        base + "/chat/completions",
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "User-Agent": "corral-react-loop/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_DEADLINE_S) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print("direct_model_call failed: %s" % e, file=sys.stderr)
        return ""
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    content = (msg.get("content") or "").strip()
    if content:
        return content
    return (msg.get("reasoning") or "").strip()


def intent_for(tool_name):
    name = (tool_name or "").lower()
    for tok in _DESTRUCTIVE_TOKENS:
        if tok in name:
            return "tool-destructive"
    for tok in _WRITE_TOKENS:
        if tok in name:
            return "tool-write"
    return "tool-read"


def execute_tool(catalog, server, tool, arguments):
    if server == "gatehouse":
        if tool == "catalog":
            return full_catalog(catalog)
        if tool == "describe":
            return tool_schema(
                catalog,
                (arguments or {}).get("server", ""),
                (arguments or {}).get("tool", ""),
            )
        return "Unknown gatehouse pseudo-tool: %s" % tool

    tool_name = "%s:%s" % (server, tool)
    cmd = intent_for(tool)
    json_args = json.dumps(arguments or {})
    result = run([
        GATEHOUSE_BIN, "call", cmd,
        "--tool-name=%s" % tool_name,
        "--json_args=%s" % json_args,
        "-c", GATEHOUSE_CONFIG, "-o", "json",
    ])
    output = (result.stdout or "") + (result.stderr or "")
    if len(output) > MAX_RESULT_CHARS:
        output = output[:MAX_RESULT_CHARS] + "\n... [truncated]"
    return output.strip() or "(empty result)"


def main():
    if len(sys.argv) < 2:
        print("Usage: claude-react-loop.py <prompt>", file=sys.stderr)
        sys.exit(1)

    catalog = fetch_catalog()
    user_prompt = sys.argv[1]
    full_prompt = build_instructions(catalog) + "\n\nTask: " + user_prompt

    for _ in range(MAX_ITERATIONS):
        output = call_model(full_prompt)

        match = re.search(r"<tool_call>\s*(.*?)\s*</tool_call>", output, re.DOTALL)
        if not match:
            print(output)
            return

        try:
            tool_call = json.loads(match.group(1))
            server = tool_call["server"]
            tool = tool_call["tool"]
            arguments = tool_call.get("arguments", {})
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print("Tool call parse error: %s\nOutput was: %s" % (e, output))
            return

        result = execute_tool(catalog, server, tool, arguments)
        full_prompt += (
            "\n\nTool call executed: %s:%s\nResult: %s\n\n"
            "Continue with the task. If done, provide final answer without tags." % (server, tool, result)
        )

    print("Max iterations reached without completion.")


if __name__ == "__main__":
    main()
