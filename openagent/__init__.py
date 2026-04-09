__version__ = "0.2.12"
__all__ = ["Agent", "load_config"]


def __getattr__(name: str):
    if name == "Agent":
        from openagent.agent import Agent

        return Agent
    if name == "load_config":
        from openagent.config import load_config

        return load_config
    raise AttributeError(name)
