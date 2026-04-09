"""Runtime path helpers for OpenAgent-managed state."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


OPENAGENT_HOME_ENV = "OPENAGENT_HOME"
DEFAULT_SYSTEM_DIRNAME = ".openagent"


@dataclass(frozen=True)
class RuntimePaths:
    root: Path
    config: Path
    db: Path
    memories: Path
    runtime: Path
    venv: Path
    logs: Path
    oauth: Path


def _resolve_root(root: str | Path | None = None) -> Path:
    if root is not None:
        return Path(root).expanduser().resolve()
    env_root = os.environ.get(OPENAGENT_HOME_ENV)
    if env_root:
        return Path(env_root).expanduser().resolve()
    return (Path.home() / DEFAULT_SYSTEM_DIRNAME).resolve()


def get_runtime_paths(root: str | Path | None = None) -> RuntimePaths:
    base = _resolve_root(root)
    runtime = base / "runtime"
    return RuntimePaths(
        root=base,
        config=base / "openagent.yaml",
        db=base / "openagent.db",
        memories=base / "memories",
        runtime=runtime,
        venv=runtime / "venv",
        logs=base / "logs",
        oauth=base / "oauth",
    )


def ensure_runtime_dirs(root: str | Path | None = None) -> RuntimePaths:
    paths = get_runtime_paths(root)
    for path in (paths.root, paths.runtime, paths.memories, paths.logs, paths.oauth):
        path.mkdir(parents=True, exist_ok=True)
    return paths


def resolve_runtime_path(value: str | Path, root: str | Path | None = None) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (get_runtime_paths(root).root / path).resolve()


def default_config_path(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).config


def default_db_path(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).db


def default_vault_path(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).memories


def default_log_dir(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).logs


def default_oauth_dir(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).oauth


def default_runtime_venv_path(root: str | Path | None = None) -> Path:
    return get_runtime_paths(root).venv


def resolve_config_path(path: str | Path | None = None) -> Path:
    if path is None:
        ensure_runtime_dirs()
        return default_config_path()
    return Path(path).expanduser().resolve()


def migrate_legacy_workspace(workspace: str | Path | None = None) -> dict[str, str]:
    """Move legacy repo-local runtime files into the system root when safe."""
    paths = ensure_runtime_dirs()
    src_root = Path(workspace).expanduser().resolve() if workspace else Path.cwd().resolve()
    if src_root == paths.root:
        return {}

    moved: dict[str, str] = {}
    for name, destination in (("openagent.yaml", paths.config),):
        source = src_root / name
        if not source.exists() or destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        moved[name] = str(destination)

    memories_source = src_root / "memories"
    if memories_source.exists():
        if not paths.memories.exists():
            paths.memories.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(memories_source), str(paths.memories))
            moved["memories"] = str(paths.memories)
        elif paths.memories.is_dir() and not any(paths.memories.iterdir()):
            for child in memories_source.iterdir():
                shutil.move(str(child), str(paths.memories / child.name))
            memories_source.rmdir()
            moved["memories"] = str(paths.memories)

    db_source = src_root / "openagent.db"
    if db_source.exists() and not paths.db.exists():
        paths.db.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(db_source), str(paths.db))
        moved["openagent.db"] = str(paths.db)

        for suffix in ("-wal", "-shm"):
            sidecar_source = src_root / f"openagent.db{suffix}"
            sidecar_destination = Path(f"{paths.db}{suffix}")
            if sidecar_source.exists() and not sidecar_destination.exists():
                shutil.move(str(sidecar_source), str(sidecar_destination))
                moved[f"openagent.db{suffix}"] = str(sidecar_destination)
    return moved
