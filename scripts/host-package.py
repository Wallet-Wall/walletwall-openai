"""Build a deterministic archive of the fixed-host runtime and systemd configuration."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

FILES = (
    "LICENSE",
    "NOTICE",
    "TRADEMARKS.md",
    "deploy/gateway.env.example",
    "deploy/systemd/walletwall-mcp.service",
    "deploy/systemd/walletwall-mcp.socket",
    "dist/THIRD_PARTY_NOTICES.md",
    "dist/handler.mjs",
    "dist/integrity.json",
    "scripts/serve.mjs",
    "src/admission.mjs",
    "src/gateway-lease.mjs",
    "src/gateway-server.mjs",
    "src/limits.mjs",
    "src/operational-metrics.mjs",
    "src/public-admission.mjs",
)


def encode(files):
    result = io.BytesIO()
    with gzip.GzipFile(fileobj=result, filename="", mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, body in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size = len(body)
                entry.mode = 0o644
                archive.addfile(entry, io.BytesIO(body))
    return result.getvalue()


def main():
    args = argparse.ArgumentParser()
    mode = args.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--out", type=Path)
    selected = args.parse_args()
    files = {name: Path(name).read_bytes() for name in FILES}
    integrity = json.loads(files["dist/integrity.json"])
    if hashlib.sha512(files["dist/handler.mjs"]).hexdigest() != integrity["handlerSha512"]:
        raise ValueError("Compiled handler does not match the integrity record.")

    payload = encode(files)
    if payload != encode(files):
        raise ValueError("Host archive is not deterministic.")
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as proof:
        if proof.getnames() != sorted(files):
            raise ValueError("Host archive inventory mismatch.")
        for member in proof:
            if not member.isfile() or proof.extractfile(member).read() != files[member.name]:
                raise ValueError("Host archive content mismatch.")

    digest = hashlib.sha512(payload).hexdigest()
    if selected.check:
        print(f"Deterministic host archive verified ({len(files)} files, SHA-512 {digest})")
        return

    output = selected.out
    sidecar = output.with_name(output.name + ".sha512")
    with output.open("xb") as handle:
        try:
            handle.write(payload)
            with sidecar.open("x") as checksum:
                checksum.write(f"{digest}  {output.name}\n")
        except BaseException:
            output.unlink()
            raise
    print(f"Wrote {output.name} and its SHA-512 sidecar.")


if __name__ == "__main__":
    main()
