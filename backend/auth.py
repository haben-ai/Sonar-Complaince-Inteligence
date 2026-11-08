"""Optional HTTP Basic auth, switched on with BASIC_AUTH_ENABLED=true."""
from __future__ import annotations

import base64
import binascii
import logging
import secrets

from backend.config import settings

log = logging.getLogger(__name__)

HEALTH_PATH = "/healthz"


class BasicAuthMiddleware:
    """Pure ASGI middleware: protects every HTTP route except the health check."""

    def __init__(self, app, username: str, password: str):
        self.app = app
        self.username = username.encode()
        self.password = password.encode()

    def _authorized(self, headers: list[tuple[bytes, bytes]]) -> bool:
        for k, v in headers:
            if k == b"authorization" and v[:6].lower() == b"basic ":
                try:
                    user, _, pw = base64.b64decode(v[6:], validate=True).partition(b":")
                except (binascii.Error, ValueError):
                    return False
                return (secrets.compare_digest(user, self.username)
                        & secrets.compare_digest(pw, self.password))
        return False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == HEALTH_PATH or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, send)
        if self._authorized(scope["headers"]):
            return await self.app(scope, receive, send)
        await send({"type": "http.response.start", "status": 401, "headers": [
            (b"www-authenticate", b'Basic realm="Maritime Safety Intelligence", charset="UTF-8"'),
            (b"content-type", b"text/plain; charset=utf-8"),
            (b"content-length", b"12"),
        ]})
        await send({"type": "http.response.body", "body": b"Unauthorized"})


def install(app) -> None:
    if not settings.basic_auth_enabled:
        return
    if settings.basic_auth_password == settings.DEFAULT_BASIC_AUTH_PASSWORD:
        log.warning("Basic auth is using the default password; set BASIC_AUTH_PASSWORD")
    app.add_middleware(BasicAuthMiddleware, username=settings.basic_auth_user,
                       password=settings.basic_auth_password)
