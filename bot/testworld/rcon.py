#!/usr/bin/env python3
# Minimal RCON client for the test world. CLI: rcon.py "command" ... ; also imported by the other scripts.
import socket, struct, sys

from slot import RCON_PORT as PORT, RUN


def _send(sock, req_id, kind, body):
    data = struct.pack("<ii", req_id, kind) + body.encode() + b"\x00\x00"
    sock.sendall(struct.pack("<i", len(data)) + data)


def _recv(sock):
    raw = b""
    while len(raw) < 4:
        raw += sock.recv(4 - len(raw))
    size = struct.unpack("<i", raw)[0]
    buf = b""
    while len(buf) < size:
        buf += sock.recv(size - len(buf))
    req_id, kind = struct.unpack("<ii", buf[:8])
    return req_id, kind, buf[8:-2].decode(errors="replace")


class Rcon:
    def __init__(self, password=None):
        pw = password or (RUN / ".rcon").read_text().strip()
        self.sock = socket.create_connection(("127.0.0.1", PORT), timeout=10)
        _send(self.sock, 1, 3, pw)
        if _recv(self.sock)[0] == -1:
            raise RuntimeError("rcon login refused")

    def run(self, command):
        _send(self.sock, 2, 2, command)
        return _recv(self.sock)[2]

    def close(self):
        self.sock.close()


if __name__ == "__main__":
    r = Rcon()
    for cmd in sys.argv[1:]:
        print(r.run(cmd))
    r.close()
