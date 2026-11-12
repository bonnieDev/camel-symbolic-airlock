# `@rmk-systems/camel-symbolic-airlock`

**A prototype "stop-and-ask" layer and signed-choice check for AI agent tool calls over the Model Context Protocol (MCP).**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-10b981?style=flat-square)](https://modelcontextprotocol.io)
[![Status](https://img.shields.io/badge/Status-Prototype-f59e0b?style=flat-square)](#status)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate?style=flat-square)](./LICENSE)

---

## Why This Exists: The Polysemy & Boundary Problem

<div align="center">
  <img src="./assets/logo.jpg" alt="CaMeL Symbolic Airlock" width="400" />
</div>

When someone writes a prompt like "clean the staging directory", "optimize the workflow", or "collaborate with other models to achieve X", the model does not decide what it wants to do. It produces output that statistically fits the request.

Ordinary words are overloaded. "Clean" can mean archive, reformat, deduplicate or delete, and a model has no shared context for which meaning you intended. If the prompt, or the tool permissions wrapped around it, is broad or missing limits, the model picks a likely path that the person never pictured.

Most agent security work defends against **outside attackers**, such as instructions hidden in a web page or an email. The person's own request is usually treated as trustworthy. This project asks a different question: what if the request is honest but unclear?

## How It Works

Two layers sit between a plain-language request and a tool call.

**Layer 1: the stop-and-ask step** (`createSymbolicRouter`)

A request passes straight through only if it names exactly one known action and, where the action needs one, a limit inside the allowed range. Anything else halts with `HALT_AMBIGUOUS_SYMBOL` and a list of choices to show as buttons and a slider. No tool runs until a person picks.

The check is a fixed word list, not a model. The same request always gets the same answer, and a request it does not recognize halts instead of running. An action that is not in the list, such as "delete everything", cannot be chosen at all.

**Layer 2: signed choices** (`CaMeLProvenanceAuthority`, `CaMeLGatekeeperVerifier`, `CaMeLMcpToolRegistry`)

When a person picks an action, the gateway wraps the choice in an Ed25519-signed envelope. A guarded tool refuses any argument that is not:

- wrapped in an envelope with a valid signature,
- marked trusted by the one role allowed to sign trusted values (the gateway that records the click), and
- on that tool's own list of allowed values.

Anything a quarantined sub-agent produces is marked untrusted, and anything derived from untrusted data stays untrusted. So text an AI reads along the way can suggest an action but cannot authorize one.

## Try It

The package is not published to npm yet. Clone the repo and run it:

```bash
git clone https://github.com/bonnieDev/camel-symbolic-airlock.git
cd camel-symbolic-airlock
npm install
npm run demo   # walks through both layers and six rejected attempts
npm test       # 24 tests, including calls over a real MCP connection
```

Requires Node.js 20 or later.

## Example

```ts
import { createSymbolicRouter } from "./src/server";

const router = createSymbolicRouter({
  actions: [
    { symbol: "ARCHIVE_SOFT_DELETE", phrases: ["archive"], limit: { min: 1, max: 50 } },
    { symbol: "DEDUPLICATE_BY_HASH", phrases: ["deduplicate", "remove duplicates"], limit: { min: 1, max: 50 } },
  ],
  ambiguousVerbs: {
    clean: ["ARCHIVE_SOFT_DELETE", "DEDUPLICATE_BY_HASH"],
  },
});

router.route("clean the staging logs");
// { status: "HALT_AMBIGUOUS_SYMBOL", detectedAmbiguity: "clean",
//   requiredEnums: ["ARCHIVE_SOFT_DELETE", "DEDUPLICATE_BY_HASH"],
//   missing: ["ACTION", "LIMIT"], sliderBounds: { min: 1, max: 50 }, ... }

router.route("archive 25 of the staging logs");
// { status: "GROUNDED_READY", actionSymbol: "ARCHIVE_SOFT_DELETE", limit: 25 }
```

The full flow, including signing a choice and calling a guarded tool, is in [`examples/demo-config.ts`](./examples/demo-config.ts) and [`examples/demo-mcp-server.ts`](./examples/demo-mcp-server.ts). [`examples/mcp-server.ts`](./examples/mcp-server.ts) shows the registry wired into an MCP server.

Entrypoints:

- `src/server` — the router, signing, verification and the guarded tool registry (Node only).
- `src/react` — a headless hook (`useCaMeLMcpAirlock`) and a reference UI component (`AirlockController`) for the choice screen.

## Status

This is a design prototype. It has not been security-audited and should not protect anything real as it stands. Known limits:

- **The word list is crude.** A vague verb that is not on the list is not flagged by name. The request still halts as "no recognized action", so it fails safe, but it will stop more often than a person would like.
- **No replay protection.** A signed envelope has a timestamp but no expiry or one-time ID, so it could be reused.
- **Reader lists are carried, not enforced.** Envelopes track who may read a value, but the tool registry does not yet check a destination against that list.
- **Signed values should be simple.** Strings, numbers and booleans are safe. Object values depend on key order when serialized.
- **Keys are your problem.** Storing, rotating and distributing keys is out of scope.
- **The React hook and component are untested.** The server code has tests; the UI pieces do not yet.

## Credit and Related Work

The idea and design direction are by Bonnie Remeika. The architecture was worked out in conversation with Google's Gemini, and the code was written and tested with AI coding assistants (Gemini and Claude).

- Layer 2 borrows the idea of provenance tags and trusted control flow from **CaMeL**: Debenedetti et al., [Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) (Google DeepMind and ETH Zurich). This project is a much simpler two-level sketch of that idea. It is not an implementation of CaMeL and is not affiliated with its authors.
- Agents asking for clarification before acting is an active research area. See Wang et al., [Learning to Ask: When LLM Agents Meet Unclear Instruction](https://arxiv.org/abs/2409.00557).
- [Signet](https://github.com/prismer-ai/signet) is a fuller open-source project for signing agent tool calls.
- The framing comes from *Tech Literacy, Translated: The Map of Everyday Tech* by Bonnie Remeika.

## License

MIT © Bonnie Remeika ([rmk.systems](https://rmk.systems))
