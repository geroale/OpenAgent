"""Generate SRP test vectors using the same code paths the Python
coordinator runs in production. We pin srptools' RNG so the salt /
client-private / server-private are deterministic across runs."""
import json, sys, secrets, hashlib
from openagent.network.coordinator.pake import (
    Srp6aBackend, srp6a_make_registration, Srp6aClientLogin,
)


def hexs(b: bytes) -> str:
    return b.hex()


def main():
    handle = "alice"
    password = "hunter2"

    # Pin secrets.token_hex/_bytes so the run is reproducible.
    rng_calls = []
    pinned_salt = bytes.fromhex("0102030405060708")
    pinned_a_priv = "11" * 32
    pinned_b_priv = "22" * 32

    real_token_hex = secrets.token_hex
    real_token_bytes = secrets.token_bytes

    def fake_token_hex(n):
        rng_calls.append(("hex", n))
        if len(rng_calls) == 1:
            return pinned_a_priv  # Srp6aClientLogin.start uses this
        if len(rng_calls) == 2:
            return pinned_b_priv  # Srp6aBackend.login_init uses this
        return real_token_hex(n)

    def fake_token_bytes(n):
        rng_calls.append(("bytes", n))
        return real_token_bytes(n)

    # Patch srptools' internal salt-randomness too. srptools calls
    # ``ctx.generate_salt()`` which uses ``random.SystemRandom().getrandbits``.
    # Easier path: monkey-patch ``SRPContext.generate_salt`` to return our
    # pinned salt.
    from srptools import SRPContext
    orig_gen_salt = SRPContext.generate_salt

    def fake_gen_salt(self):
        return int.from_bytes(pinned_salt, "big")

    SRPContext.generate_salt = fake_gen_salt
    secrets.token_hex = fake_token_hex
    secrets.token_bytes = fake_token_bytes
    try:
        # 1. Register payload (uses pinned salt).
        register_payload = srp6a_make_registration(handle, password)

        # 2. Client login start (uses pinned a_priv).
        client = Srp6aClientLogin.start(handle, password)
        ke1 = client.A

        # 3. Server login_init (uses pinned b_priv).
        backend = Srp6aBackend()
        state, response = backend.login_init(handle, register_payload, ke1)

        # 4. Client respond.
        m1 = client.respond(response)

        # 5. Server verify.
        m2 = backend.login_finish(state, m1)
    finally:
        SRPContext.generate_salt = orig_gen_salt
        secrets.token_hex = real_token_hex
        secrets.token_bytes = real_token_bytes

    # Sanity: client's expected M2 == server's M2.
    client.verify_server(m2)

    # Extract verifier alone for round-trip check.
    salt_len = register_payload[0]
    salt = register_payload[1 : 1 + salt_len]
    verifier = register_payload[1 + salt_len :]

    out = {
        "handle": handle,
        "password": password,
        "salt": hexs(salt),
        "verifier": hexs(verifier),
        "register_payload": hexs(register_payload),
        "client_a_priv": pinned_a_priv,
        "ke1_A": hexs(ke1),
        "server_b_priv": pinned_b_priv,
        "server_response": hexs(response),
        "expected_M1": hexs(m1),
        "expected_M2": hexs(m2),
    }
    json.dump(out, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
