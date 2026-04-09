from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import importlib.util

from openagent.runtime import get_runtime_paths

HAS_YAML = importlib.util.find_spec("yaml") is not None

if HAS_YAML:
    from openagent.config import load_config
else:  # pragma: no cover - env guard
    load_config = None


class RuntimePathTests(unittest.TestCase):
    def test_runtime_paths_follow_openagent_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"OPENAGENT_HOME": tmp}, clear=False):
                paths = get_runtime_paths()
                self.assertEqual(paths.root, Path(tmp).resolve())
                self.assertEqual(paths.config, Path(tmp).resolve() / "openagent.yaml")
                self.assertEqual(paths.memories, Path(tmp).resolve() / "memories")

    @unittest.skipUnless(HAS_YAML, "PyYAML is not installed in this environment")
    def test_load_config_migrates_legacy_workspace_when_using_defaults(self):
        with tempfile.TemporaryDirectory() as runtime_tmp, tempfile.TemporaryDirectory() as workspace_tmp:
            workspace = Path(workspace_tmp)
            (workspace / "openagent.yaml").write_text("name: migrated\n", encoding="utf-8")
            (workspace / "openagent.db").write_text("", encoding="utf-8")
            (workspace / "openagent.db-wal").write_text("wal", encoding="utf-8")
            (workspace / "openagent.db-shm").write_text("shm", encoding="utf-8")
            (workspace / "memories").mkdir()
            (workspace / "memories" / "note.md").write_text("# hello\n", encoding="utf-8")

            with patch.dict(os.environ, {"OPENAGENT_HOME": runtime_tmp}, clear=False):
                old_cwd = Path.cwd()
                os.chdir(workspace)
                try:
                    config = load_config(None)
                finally:
                    os.chdir(old_cwd)

            runtime_root = Path(runtime_tmp).resolve()
            self.assertEqual(config["name"], "migrated")
            self.assertTrue((runtime_root / "openagent.yaml").exists())
            self.assertTrue((runtime_root / "openagent.db").exists())
            self.assertTrue((runtime_root / "openagent.db-wal").exists())
            self.assertTrue((runtime_root / "openagent.db-shm").exists())
            self.assertTrue((runtime_root / "memories" / "note.md").exists())
            self.assertFalse((workspace / "openagent.yaml").exists())
            self.assertFalse((workspace / "openagent.db-wal").exists())
            self.assertFalse((workspace / "openagent.db-shm").exists())

    @unittest.skipUnless(HAS_YAML, "PyYAML is not installed in this environment")
    def test_explicit_config_path_does_not_depend_on_system_root(self):
        with tempfile.TemporaryDirectory() as runtime_tmp, tempfile.TemporaryDirectory() as workspace_tmp:
            config_path = Path(workspace_tmp) / "custom.yaml"
            config_path.write_text("name: explicit\nmemory:\n  db_path: custom.db\n", encoding="utf-8")
            with patch.dict(os.environ, {"OPENAGENT_HOME": runtime_tmp}, clear=False):
                config = load_config(config_path)
            self.assertEqual(config["name"], "explicit")
            self.assertEqual(
                Path(config["memory"]["db_path"]),
                Path(runtime_tmp).resolve() / "custom.db",
            )


if __name__ == "__main__":
    unittest.main()
