#!/usr/bin/env python3
"""CLI wrapper for EnvCP - proxies commands to the Node.js package."""

import subprocess
import sys
import shutil


def check_nodejs():
    """Check if Node.js is available."""
    if not shutil.which("node"):
        print("Error: Node.js is required but not installed.", file=sys.stderr)
        print("Please install Node.js from https://nodejs.org", file=sys.stderr)
        sys.exit(1)


def check_npx():
    """Check if npx is available."""
    if not shutil.which("npx"):
        print("Error: npx is required but not installed.", file=sys.stderr)
        print("npx comes with Node.js - please reinstall Node.js from https://nodejs.org", file=sys.stderr)
        sys.exit(1)


def main():
    """Main entry point - proxy to Node.js CLI."""
    check_nodejs()
    check_npx()
    
    # Pass all arguments to the Node.js CLI via npx
    result = subprocess.run(
        ["npx", "@fentz26/envcp"] + sys.argv[1:],
        cwd="."  # Use current directory
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
