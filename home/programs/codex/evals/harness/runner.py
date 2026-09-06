import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time


def summarize(events, exit_code, elapsed):
    totals = {key: 0 for key in ("input_tokens", "output_tokens", "cached_input_tokens", "reasoning_output_tokens")}
    completed = False
    messages = []
    tool_calls = 0
    errors = []
    for event in events:
        if event.get("type") == "turn.completed":
            completed = True
            for key in totals:
                totals[key] += event.get("usage", {}).get(key, 0)
        if event.get("type") in ("turn.failed", "error"):
            errors.append(event)
        item = event.get("item", {})
        if event.get("type") == "item.completed":
            if item.get("type") == "agent_message":
                messages.append(item.get("text", ""))
            elif item.get("type") in ("command_execution", "mcp_tool_call", "collab_tool_call"):
                tool_calls += 1
    return dict(totals, elapsed_seconds=elapsed, completed_turn=completed and exit_code == 0 and not errors,
                exit_code=exit_code, tool_calls=tool_calls, messages=messages, errors=errors)


def session_usage(codex_home):
    reports = {}
    seen = set()
    finished, unfinished, expected_children, children = set(), set(), set(), set()
    for path in (codex_home / "sessions").rglob("*.jsonl"):
        identity, latest = str(path), None
        terminal = False
        for line in path.read_text().splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = event.get("payload", {})
            if event.get("type") == "session_meta":
                identity = payload.get("id", identity)
                source = payload.get("source", {})
                child = source.get("subagent", {}).get("thread_spawn", {}) if isinstance(source, dict) else {}
                if child:
                    children.add((child.get("parent_thread_id"), child.get("agent_path", "").split("/")[-1]))
            if event.get("type") == "response_item" and payload.get("type") == "function_call" and payload.get("name", "").split(".")[-1] == "spawn_agent":
                try:
                    name = json.loads(payload.get("arguments", "{}" )).get("task_name")
                except json.JSONDecodeError:
                    name = None
                expected_children.add((identity, name))
            if event.get("type") == "event_msg" and payload.get("type") in ("task_started", "task_complete", "turn_aborted", "task_failed"):
                terminal = payload["type"] == "task_complete"
            if event.get("type") == "event_msg" and payload.get("type") == "token_count":
                usage = (payload.get("info") or {}).get("total_token_usage")
                if usage:
                    latest = usage
        seen.add(identity)
        if terminal:
            finished.add(identity)
        else:
            unfinished.add(identity)
        if latest and latest.get("total_tokens", 0) >= reports.get(identity, {}).get("total_tokens", 0):
            reports[identity] = latest
    totals = {}
    for usage in reports.values():
        for key, value in usage.items():
            if isinstance(value, int):
                totals[key] = totals.get(key, 0) + value
    return dict(totals=totals or None, reported_sessions=len(reports), session_count=len(seen),
                complete=bool(seen and not unfinished and seen == reports.keys() and seen == finished and expected_children <= children))


def copy_tree(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True)


def fixture_path(repo, name):
    path = Path(name)
    if not name or path.is_absolute() or any(part in ("", ".", "..") or part.lower() == ".git"
                                            for part in name.split("/")):
        raise ValueError(f"unsafe fixture path: {name}")
    destination = (repo / path).resolve()
    if not destination.is_relative_to(repo.resolve()):
        raise ValueError(f"fixture path escapes repository: {name}")
    return destination


def git_environment(home):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update(HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"),
                       GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_TEMPLATE_DIR="")
    return environment


def run(args):
    if not all(re.fullmatch(r"[A-Za-z0-9_-]+", value) for value in (args.case, args.variant)):
        raise ValueError("case and variant must be simple labels")
    if args.prior_sessions < 0:
        raise ValueError("prior sessions cannot be negative")
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    lock = output / "runner.lock"
    for attempt in range(500):
        try:
            with lock.open("x"):
                pass
            break
        except FileExistsError:
            if attempt == 499:
                raise RuntimeError("another runner holds the reservation lock")
            time.sleep(0.01)
    owns_lock = True
    try:
        records = list(output.glob("run-*/result.json"))
        reserved = list(output.glob("run-*/manifest.json"))
        if len(reserved) + args.prior_sessions >= 40:
            raise RuntimeError("40-session cap reached")
        case = json.loads(Path(args.cases).read_text())[args.case]
        work = output / f"run-{len(reserved) + 1:02d}-{args.variant}-{args.case}"
        work.mkdir()
        (work / "manifest.json").write_text(json.dumps(dict(status="preparing", case=args.case, variant=args.variant)))
        lock.unlink()
        owns_lock = False
        home = work / "home"
        repo = work / "repo"
        repo.mkdir()
        for collection in (case["files"], case.get("changes", {})):
            for name in collection:
                fixture_path(repo, name)
        codex_home = home / ".codex"
        plans = codex_home / "plans"
        plans.mkdir(parents=True)
        skills = home / ".agents/skills"
        skills.mkdir(parents=True)
        codex_source = source / "home/programs/codex"
        for skill in ("plan", "impl"):
            copy_tree(codex_source / "skills" / skill, skills / skill)
        shared = source / "home/programs/agents/shared/plan/references"
        copy_tree(shared, skills / "plan/references")
        (codex_home / "scripts").mkdir()
        for script in (codex_source / "scripts").glob("codex-plan-*.ts"):
            shutil.copy2(script, codex_home / "scripts" / script.name)
        copy_tree(codex_source / "agents", codex_home / "agents")
        for definition in (codex_home / "agents").glob("*.toml"):
            definition.write_text(definition.read_text().replace(str(Path(args.root).resolve()), str(source)))
        copy_tree(source / "home/programs/agents/skills/requirements-interview", skills / "requirements-interview")
        agent_scripts = home / ".agents/scripts"
        agent_scripts.mkdir()
        shutil.copyfile(Path(args.root) / "home/programs/agents/scripts/check-plan.ts", agent_scripts / "check-plan.ts")
        for name in ("check-plan.ts",):
            (agent_scripts / name).chmod(0o755)
        auth = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "auth.json"
        if auth.exists():
            (codex_home / "auth.json").symlink_to(auth)
        for name, contents in case["files"].items():
            file = fixture_path(repo, name)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(contents)
        git_env = git_environment(home)
        subprocess.run(["git", "init", "-q", str(repo)], check=True, env=git_env)
        for command in (["config", "user.email", "test@example.invalid"], ["config", "user.name", "Test"],
                        ["add", "."], ["commit", "-qm", "fixture"]):
            subprocess.run(["git", *command], cwd=repo, check=True, env=git_env)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True, env=git_env).strip()
        for name, contents in case.get("changes", {}).items():
            file = fixture_path(repo, name)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(contents)
        prompt = case["prompt"]
        if case.get("plan"):
            plan = plans / "case.md"
            plan.write_text(case["plan"].replace("{repo}", str(repo)))
            sidecar = dict(plan="case.md", tasks=[
                dict(id="task-1", subject="Behavior", baseline_sha=head, evidence=case.get("evidence", "python3 main.py: ready (PASS)"), status="completed"),
                dict(id="task-2", subject="Final Audit + Review", baseline_sha=None, evidence=None, status="pending"),
            ])
            (plans / "case.evidence.json").write_text(json.dumps(sidecar))
            cwd_hash = hashlib.sha256(str(repo.resolve()).encode()).hexdigest()[:16]
            marker = plans / f".active-{cwd_hash}"
            marker.write_text(str(plan) + "\n")
            if case.get("expired"):
                os.utime(marker, (time.time() - 90000, time.time() - 90000))
            prompt = prompt.replace("{plan}", str(plan))
        prompt = prompt.replace("{repo}", str(repo))
        environment = git_env.copy()
        environment.update(HOME=str(home), CODEX_HOME=str(codex_home))
        environment.pop("CODEX_THREAD_ID", None)
        environment.pop("TMUX_PANE", None)
        binary = next((str((Path(folder) / "codex").resolve())
                       for folder in os.environ["PATH"].split(os.pathsep)
                       if (Path(folder) / "codex").is_file()
                       and (Path(folder) / "codex").resolve().name != "mise"), None)
        if not binary:
            raise RuntimeError("resolve a Codex executable outside mise shims before evaluation")
        command = [binary, "exec", "--ignore-user-config", "--json", "--enable", "multi_agent_v2",
                   "-m", "gpt-6-astra", "-c", f'model_reasoning_effort="{args.effort}"',
                   "-c", "model_context_window=872000", "-s", "workspace-write",
                   "--add-dir", str(plans), "-C", str(repo), prompt]
        manifest = dict(case=args.case, variant=args.variant, effort=args.effort, model="gpt-6-astra",
                        source=str(source), command=command, timeout=args.timeout,
                        runner_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                        case_sha256=hashlib.sha256(json.dumps(case, sort_keys=True).encode()).hexdigest(),
                        source_sha256={str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                                       for p in source.rglob("*") if p.is_file()},
                        started=time.time(), previous_completed=len(records))
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
        shutil.copyfile(__file__, work / "runner.py")
        started = time.monotonic()
        answers = list(case.get("answers", []))
        used_answers = []
        commands = [command]
        while True:
            with (work / "events.jsonl").open("a") as stdout, (work / "stderr.log").open("a") as stderr:
                process = subprocess.Popen(commands[-1], cwd=repo, env=environment, stdin=subprocess.DEVNULL,
                                           stdout=stdout, stderr=stderr, start_new_session=True)
                try:
                    exit_code = process.wait(timeout=max(1, args.timeout - (time.monotonic() - started)))
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                    exit_code = 124
            events = []
            for line in (work / "events.jsonl").read_text().splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            turn_result = summarize(events, exit_code, time.monotonic() - started)
            last_message = "\n".join(turn_result["messages"][-1:])
            if exit_code or not answers or not any(mark in last_message for mark in ("?", "？")):
                break
            thread = next(event["thread_id"] for event in events if event.get("type") == "thread.started")
            answer = answers.pop(0)
            used_answers.append(answer)
            commands.append([binary, "exec", "resume", "--ignore-user-config", "--json", "--enable", "multi_agent_v2",
                             "-m", "gpt-6-astra", "-c", f'model_reasoning_effort="{args.effort}"', thread, answer])
        result = summarize(events, exit_code, time.monotonic() - started)
        result.update(case=args.case, variant=args.variant, verdict="unadjudicated",
                      scripted_answers_used=used_answers, commands=commands)
        result["tree_usage"] = session_usage(codex_home)
        result["tree_usage"]["complete"] &= result["completed_turn"]
        evidence = plans / "case.evidence.json"
        if evidence.exists():
            result["final_evidence"] = json.loads(evidence.read_text())
        (work / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
        print(json.dumps({key: result[key] for key in ("case", "variant", "completed_turn", "elapsed_seconds", "input_tokens", "output_tokens", "verdict")}), flush=True)
    finally:
        if owns_lock:
            lock.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[5]))
    parser.add_argument("--output", required=True)
    parser.add_argument("--cases", default=str(Path(__file__).with_name("cases.json")))
    parser.add_argument("--case", required=True)
    parser.add_argument("--variant", required=True)
    parser.add_argument("--effort", choices=("high", "xhigh"), default="xhigh")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--prior-sessions", type=int, default=1)
    run(parser.parse_args())
