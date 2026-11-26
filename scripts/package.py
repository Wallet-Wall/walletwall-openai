"""Reproducible ZIP for one portable plugin, gated on owner-supplied release configuration."""
import argparse
import hashlib
import io
import ipaddress
import json
from pathlib import Path
import re
import struct
import subprocess
from urllib.parse import quote, urlsplit
import zipfile

FIXTURES = (
    "conflict-CNF-002.json",
    "normalize-balance.json",
    "provenance-label.json",
    "readiness-established.json",
    "readiness-incomplete.json",
    "wwep-claims.json",
    "wwep-evidence.schema.json",
)
LISTING_URLS = ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL")
CONFIG_KEYS = ("mcp_url", "demo_url", "fixtures_url", "developer_name", *LISTING_URLS)
PUBLIC_FIELDS = {
    "description", "prompt", "tools_triggered", "expected_behavior", "file_attachment_urls",
}
ICON_PATH = "assets/icon.png"


def public_url(value):
    if not isinstance(value, str) or not value or len(value) > 1024 or re.search(r"[\s{}<>\\]", value):
        raise ValueError("A valid HTTPS release URL is required.")
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("Use an approved DNS hostname for release URLs.")
    reserved = ("invalid", "localhost", "local", "example", "test", "internal")
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
            or not re.fullmatch(r"[a-z0-9.-]+", host) or host.endswith(".")
            or parsed.port not in (None, 443) or "." not in host or host.split(".")[-1] in reserved
            or host in {"example.org", "example.net", "example.com"}
            or any(host.endswith("." + suffix) for suffix in ("example.org", "example.net", "example.com"))):
        raise ValueError("A public HTTPS release URL is required.")
    return parsed


def manifest(config, check=False):
    if not isinstance(config, dict) or set(config) != set(CONFIG_KEYS):
        raise ValueError("Release configuration is incomplete or contains unexpected fields.")
    if not check:
        for key in ("mcp_url", "demo_url", "fixtures_url", *LISTING_URLS):
            public_url(config[key])
        for key in ("mcp_url", "fixtures_url"):
            url = urlsplit(config[key])
            if url.query or url.fragment:
                raise ValueError("The endpoint and fixture base URLs cannot contain a query or fragment.")
        if not urlsplit(config["mcp_url"]).path.endswith("/mcp"):
            raise ValueError("The approved endpoint URL must end in /mcp.")
    developer = config["developer_name"]
    if not isinstance(developer, str) or not developer.strip() or len(developer) > 80 or not developer.isprintable():
        raise ValueError("A verified developer display name is required.")

    plugin = json.loads(Path("plugin/plugin.json").read_text())
    ext = plugin["extensions"]["com.openai"]
    ext["interface"].update({key: config[key] for key in LISTING_URLS})
    ext["interface"]["developerName"] = developer
    ext["review"]["demo_recording_url"] = config["demo_url"]
    cases = json.loads(Path("plugin/review-cases.json").read_text())
    for group, count in (("positive", 5), ("negative", 3)):
        if len(cases[group]) != count:
            raise ValueError("Wrong number of review cases.")
        for case in cases[group]:
            fixtures = case.pop("fixtures", [])
            if fixtures:
                if any(name not in FIXTURES for name in fixtures):
                    raise ValueError("Unknown review fixture.")
                case["file_attachment_urls"] = [
                    config["fixtures_url"].rstrip("/") + "/" + quote(name) for name in fixtures
                ]
            needed = {"description", "prompt"}
            if group == "positive":
                needed |= {"tools_triggered", "expected_behavior"}
            if not needed <= case.keys() <= PUBLIC_FIELDS or not all(case[key] for key in needed):
                raise ValueError("Invalid OpenAI review case.")
    ext["review"]["test_cases"] = cases
    for key, cap in (("displayName", 30), ("shortDescription", 30), ("longDescription", 4000)):
        if not 0 < len(ext["interface"][key]) <= cap:
            raise ValueError("Invalid listing length.")
    prompts = ext["interface"]["defaultPrompt"]
    if not 0 < len(prompts) <= 3 or len(set(prompts)) != len(prompts) or any(
        not 0 < len(prompt) <= 128 or not prompt.isprintable() or "@" in prompt for prompt in prompts
    ):
        raise ValueError("Invalid listing prompts.")
    mcp = {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"walletwall": {"type": "streamable-http", "url": config["mcp_url"]}},
    }
    return {"plugin": plugin, "mcp": mcp}


def contents(pair):
    def json_bytes(value):
        return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()

    icon = Path(".upstream/source/docs/claude-directory/icon.png").read_bytes()
    if (icon[:16] != bytes.fromhex("89504e470d0a1a0a0000000d49484452")
            or struct.unpack(">II", icon[16:24]) != (1024, 1024) or len(icon) > 5 * 1024 * 1024
            or hashlib.sha512(icon).hexdigest() != json.loads(Path("upstream.json").read_text())["iconSha512"]):
        raise ValueError("Approved icon integrity mismatch.")
    files = {
        "plugin.json": json_bytes(pair["plugin"]),
        "mcp.json": json_bytes(pair["mcp"]),
        ICON_PATH: icon,
        "LICENSE": Path("LICENSE").read_bytes(),
        "NOTICE": Path("NOTICE").read_bytes(),
        "TRADEMARKS.md": Path("TRADEMARKS.md").read_bytes(),
        "skills/vault-readiness/SKILL.md": Path("plugin/skills/vault-readiness/SKILL.md").read_bytes(),
        **{
            "skills/vault-readiness/references/" + name: (Path("dist/fixtures") / name).read_bytes()
            for name in FIXTURES
        },
    }
    secrets = re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[psoaur]_[A-Za-z0-9]{28,}|sk-[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16}")
    for path, data in files.items():
        if path != ICON_PATH and secrets.search(data):
            raise ValueError("Unexpected secret-shaped package content.")
    return files


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as bundle:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, data, compress_type=zipfile.ZIP_STORED)
    encoded = stream.getvalue()
    with zipfile.ZipFile(io.BytesIO(encoded)) as proof:
        if set(proof.namelist()) != files.keys() or proof.testzip() is not None:
            raise ValueError("ZIP inventory or CRC verification failed.")
        if any(proof.read(name) != data for name, data in files.items()):
            raise ValueError("ZIP content verification failed.")
    return encoded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--release-config", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.check and (args.release_config or args.out):
        parser.error("--check is an in-memory package test.")
    if args.check:
        config = dict.fromkeys(CONFIG_KEYS, "https://walletwall.invalid")
        config.update(mcp_url="https://walletwall.invalid/mcp", developer_name="Synthetic schema test")
        try:
            manifest(config, check=False)
        except ValueError:
            pass
        else:
            raise ValueError("Release mode accepted a reserved hostname.")
    elif args.release_config and args.out and args.out.suffix == ".zip":
        config = json.loads(args.release_config.read_text())
    else:
        parser.error("Use --check, or provide --release-config and a .zip --out.")

    pair = manifest(config, check=args.check)
    subprocess.run(["node", "scripts/package-schemas.mjs", "--validate-stdin"],
                   input=json.dumps(pair).encode(), check=True)
    files = contents(pair)
    encoded = archive(files)
    if encoded != archive(files):
        raise ValueError("Archive generation was nondeterministic.")
    if args.check:
        print(f"Portable schema and deterministic ZIP checks passed ({len(files)} files); no test ZIP written.")
        return
    digest = hashlib.sha512(encoded).hexdigest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("xb") as stream:
        try:
            stream.write(encoded)
            with args.out.with_suffix(".zip.sha512").open("x") as sidecar:
                sidecar.write(f"{digest}  {args.out.name}\n")
        except BaseException:
            args.out.unlink()
            raise
    print(f"Created {args.out.name} and SHA-512 record.")


if __name__ == "__main__":
    main()
