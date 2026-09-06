import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner", pathlib.Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ResultsTest(unittest.TestCase):
    def test_tree_usage_includes_children_without_summing_cumulative_events(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp)
            sessions = home / "sessions"
            sessions.mkdir()
            for name, amounts in (("parent", [100, 200]), ("child", [50])):
                events = [{"type": "session_meta", "payload": {"id": name}}]
                events += [{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": amount}}}} for amount in amounts]
                (sessions / f"{name}.jsonl").write_text("\n".join(runner.json.dumps(e) for e in events))
            result = runner.session_usage(home)
            self.assertEqual(result["totals"]["total_tokens"], 250)
            self.assertEqual(result["reported_sessions"], 2)
            self.assertEqual(runner.session_usage(home / "missing")["totals"], None)

    def test_tree_usage_is_incomplete_for_interrupted_or_missing_children(self):
        with tempfile.TemporaryDirectory() as temp:
            home = pathlib.Path(temp)
            sessions = home / "sessions"
            sessions.mkdir()
            parent = [
                {"type": "session_meta", "payload": {"id": "parent", "source": "exec"}},
                {"type": "response_item", "payload": {"type": "function_call", "name": "spawn_agent", "arguments": '{"task_name":"review"}'}},
                {"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": 100}}}},
                {"type": "event_msg", "payload": {"type": "task_complete"}},
            ]
            (sessions / "parent.jsonl").write_text("\n".join(runner.json.dumps(e) for e in parent))
            self.assertFalse(runner.session_usage(home)["complete"])
            child = [
                {"type": "session_meta", "payload": {"id": "child", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "parent", "agent_path": "/root/review"}}}}},
                {"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": 50}}}},
                {"type": "event_msg", "payload": {"type": "turn_aborted"}},
            ]
            path = sessions / "child.jsonl"
            path.write_text("\n".join(runner.json.dumps(e) for e in child))
            self.assertFalse(runner.session_usage(home)["complete"])
            child[-1]["payload"]["type"] = "task_complete"
            path.write_text("\n".join(runner.json.dumps(e) for e in child))
            self.assertTrue(runner.session_usage(home)["complete"])

    def test_fixture_paths_cannot_escape_or_control_git(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = pathlib.Path(temp) / "repo"
            repo.mkdir()
            for name in ("../home/.codex/auth.json", "/tmp/escape", ".git/config", "nested/.GIT/config", "a/../b", ""):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    runner.fixture_path(repo, name)
            (repo / "link").symlink_to(pathlib.Path(temp))
            with self.assertRaises(ValueError):
                runner.fixture_path(repo, "link/secret")
            self.assertEqual(runner.fixture_path(repo, "src/main.py"), (repo / "src/main.py").resolve())

    def test_fixture_git_does_not_inherit_configuration(self):
        with patch.dict(runner.os.environ, {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": "/unsafe", "GIT_DIR": "/unsafe", "PATH": "/bin"}):
            environment = runner.git_environment(pathlib.Path("/fixture/home"))
        self.assertNotIn("GIT_CONFIG_COUNT", environment)
        self.assertNotIn("GIT_DIR", environment)
        self.assertEqual(environment["GIT_CONFIG_GLOBAL"], runner.os.devnull)
        self.assertEqual(environment["GIT_CONFIG_NOSYSTEM"], "1")
        self.assertEqual(environment["PATH"], "/bin")

    def test_failure_cannot_be_measured_as_successful_completion(self):
        result = runner.summarize([
            {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 20}},
            {"type": "turn.failed", "error": {"message": "model unavailable"}},
        ], 1, 2.0)
        self.assertFalse(result["completed_turn"])
        self.assertEqual(result["input_tokens"], 100)

    def test_usage_accumulates_instead_of_taking_last_event(self):
        result = runner.summarize([
            {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 20}},
            {"type": "turn.completed", "usage": {"input_tokens": 200, "output_tokens": 30}},
        ], 0, 4.0)
        self.assertEqual(result["input_tokens"], 300)
        self.assertEqual(result["output_tokens"], 50)
        self.assertTrue(result["completed_turn"])


if __name__ == "__main__":
    unittest.main()
