"""Import a design from a URL.

Supports direct file URLs and share links whose page is an HTML viewer (Box). Box share
links (https://<org>.app.box.com/s/<shared_name>) are resolved to the file download by
reading the file id from the share page.
Only http(s); private / loopback addresses are refused; 80 MB limit.
"""
from __future__ import annotations

import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from dataclasses import dataclass

MAX_BYTES = 80 * 1024 * 1024
UA = "Mozilla/5.0 (maritime-safety-intelligence; design import)"


class ImportErrorWithHint(Exception):
    pass


@dataclass
class Downloaded:
    data: bytes
    filename: str
    content_type: str
    resolved_from: str | None = None


def _check_host(url: str) -> None:
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ImportErrorWithHint("Only http(s) URLs are supported.")
    try:
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise ImportErrorWithHint("URL resolves to a private/local address - refused.")
    except socket.gaierror:
        raise ImportErrorWithHint(f"Host not found: {u.hostname}")


def _get(url: str) -> tuple[bytes, str, str]:
    _check_host(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        ctype = r.headers.get("Content-Type", "")
        cd = r.headers.get("Content-Disposition", "")
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ImportErrorWithHint("File larger than 80 MB.")
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cd)
    name = urllib.parse.unquote(m.group(1)) if m else ""
    return data, ctype, name


def _resolve_box(url: str, html: str) -> tuple[str, str]:
    u = urllib.parse.urlparse(url)
    m = re.search(r"/s/([A-Za-z0-9]+)", u.path)
    fid = re.search(r'"typedID":"f_(\d+)"', html)
    if not m or not fid:
        if re.search(r'"typedID":"d_\d+"', html):
            raise ImportErrorWithHint("This Box link is a folder. Open it and share the link of the individual drawing file.")
        raise ImportErrorWithHint("Could not find a file in this Box share page.")
    name = re.search(r'"name":"([^"]+\.(?:pdf|png|jpe?g|json))"', html, re.I)
    dl = f"{u.scheme}://{u.netloc}/index.php?rm=box_download_shared_file&shared_name={m.group(1)}&file_id=f_{fid.group(1)}"
    return dl, (name.group(1) if name else f"box_{fid.group(1)}.pdf")


def download(url: str) -> Downloaded:
    data, ctype, name = _get(url)
    resolved = None
    if "text/html" in ctype:
        html = data.decode("utf-8", "ignore")
        if "box.com" in (urllib.parse.urlparse(url).hostname or ""):
            dl, name = _resolve_box(url, html)
            resolved = url
            data, ctype, n2 = _get(dl)
            name = n2 or name
        else:
            raise ImportErrorWithHint("The URL returns a web page, not a drawing file. Use the direct download link of the PDF/image.")
    if not name:
        name = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1] or "download"
    if data[:4] == b"%PDF" and not name.lower().endswith(".pdf"):
        name += ".pdf"
    return Downloaded(data, name, ctype, resolved)
