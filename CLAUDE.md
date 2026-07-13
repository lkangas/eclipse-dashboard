# Working preferences for this repo

## Git

- Commit AND push whenever a change is verified working (tests pass, type-check clean, and/or live-verified) — don't wait to be asked for either. This overrides the general "only commit/push when explicitly asked" default for this repo specifically.
- Before every commit/push, check the diff for secrets, API keys, tokens, passwords, hostnames, IP addresses, or other user-/environment-specific data (e.g. a real COM port, a real device serial number, a personal file path) that shouldn't leave the machine. If anything like that shows up, strip it or ask before proceeding — don't push it "because the policy says push automatically."

This file lives inside the OneDrive-synced project folder on purpose, so it travels across machines even though Claude's own memory store (`~/.claude/...`) does not.
