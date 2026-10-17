"""Tool definitions the LLM can call, each wrapping an engine/ function or a channel/payment action.

Every tool call passes through guards.check() and is written to the audit log."""
