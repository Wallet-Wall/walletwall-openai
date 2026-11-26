"""Test handoff of one already listening socket to the Node TLS gateway."""
import os
import socket
import sys

listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.bind(("127.0.0.1", 0))
listener.listen(8)
os.dup2(listener.fileno(), 3, inheritable=True)
os.set_inheritable(3, True)
os.environ["LISTEN_PID"] = str(os.getpid())
os.environ["LISTEN_FDS"] = "1"
print("test socket port", listener.getsockname()[1], flush=True)
os.execv(sys.argv[1], sys.argv[1:])
