"""A private pilot server lets only the configured owner sign up and sign in with a password.

Runner: own-server
"""
import director
from director import Client
from director_recovery import server

OWNER = "owner-chad@example.test"
PILOT = {
    "STUDIO_PILOT_CODE": "ab" * 32, "STUDIO_PILOT_EMAIL": "pilot@studio.invalid", "COOKIE_SECURE": "1",
    "STUDIO_OWNER_EMAIL": OWNER.upper(), "STUDIO_OWNER_CREDITS": "5000",
}


def main():
    with server("mock", **PILOT):
        c = Client()
        c.request("/api/auth/guest", {}, status=404)
        c.request("/api/auth/signup", {"email": "someone@example.test", "password": "fixture-password"}, status=404)
        c.request("/api/auth/login", {"email": "someone@example.test", "password": "fixture-password"}, status=404)
        made = c.request("/api/auth/signup", {"email": OWNER, "password": "fixture-password", "name": "Chad"})
        assert made["user"]["email"] == OWNER and made["balance"] == 5000 * 1000, made
        c.request("/api/auth/signup", {"email": OWNER, "password": "fixture-password"}, status=400)
        c.request("/api/auth/login", {"email": OWNER, "password": "wrong-password"}, status=400)
        again = Client().request("/api/auth/login", {"email": OWNER, "password": "fixture-password"})
        assert again["user"]["id"] == made["user"]["id"] and again["balance"] == 5000 * 1000, again
    # Without an owner address, a pilot server keeps password accounts closed.
    with server("mock", **{**PILOT, "STUDIO_OWNER_EMAIL": ""}):
        Client().request("/api/auth/login", {"email": OWNER, "password": "fixture-password"}, status=404)
    print("PASS: owner-only password accounts on a private pilot server, with testing credits")


if __name__ == "__main__":
    main()
