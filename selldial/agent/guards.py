"""Guard rules that gate every agent action.

1. No discount outside the policy table.
2. No account change before the caller is verified.
3. Purchases above the owner's limit need the owner's yes by text.
4. Every recommendation gives a one-sentence reason and the runner-up.
5. If unsure, hand off to a human with a summary.
6. Log every action to the audit log.
7. Only state numbers that came from tool results.

Money is integer cents everywhere."""
