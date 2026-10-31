# Spec: `owner-provenance-interview`

- **ID**: SKILL-SPEC-95439ae31a
- **Source retrospective**: ../2026-10-19-3.md

## Intent

Establish, for every requirement and decision in an AI-written specification, whether it came from the owner, was proposed by an AI and approved, was proposed by an AI only, or cannot be traced, by putting short numbered batches of questions to the owner and waiting for answers before changing anything. AI-written specifications turn asides and examples into binding rules; in the source session the owner had typed none of the spec, and the interview overturned several 'requirements' (browser-to-storage CORS, script bearer-token auth, queues) that the owner never asked for.

## Trigger

**Direct:**
- "where did this come from?"
- "what is the origin of this?"
- "I did not write this spec"
- "point out decisions where it is unclear where they come from"

**Proactive:** offer it before reorganizing or implementing any specification that was written mainly by AI agents, especially one with several revisions written by different AIs.

**Do not trigger:**
- when the owner wrote the document themselves;
- when every item already carries an origin.

## Inputs

- The specification files. If there are several versions, a read-only subagent compares them, so the main context never holds conflicting versions. The owner asked for this in the source session (D6).
- The list of origin values. The source session used:
  - `owner`
  - `owner-approved`
  - `ai-proposed`
  - `provenance-unclear`
  - `derived`
- Where decisions are recorded, for example `docs/decisions/decision-log.md`.

## Outputs

- A numbered question batch per round, in chat.
- After each answer, decision-log entries with an origin, and edits that bring the documents in line.
- Removed items recorded **only** in the decision log, as the owner instructs. They are never kept in the spec as "not now" notes.

## Workflow

1. **Compare versions.** Have a read-only subagent compare the versions and return a table: topic | in the original? (same / weaker / absent) | what the revision added | references. Tell it to quote at most about 25 words at a time.
2. **Pick candidates.** Select items whose origin is unclear or which look like hardened asides: concrete limits, specific tools, browser behavior, auth mechanisms, operational machinery.
3. **Ask in batches.** Group the items into lettered batches of at most about 10 (A1…A10, B11…). Each question states the item, where it appears, the agent's guess at its origin, and what changes if it is not a requirement.
4. **Stop and wait.** Never edit documents during a question round.
5. **Record each answer** literally:
   - "my requirement" → `owner`;
   - "AI suggested, I agreed" → `owner-approved`;
   - "I don't care / your call" → `ai-proposed`, even when the AI's choice was accepted. The owner's decision there was not to decide.
   - "I never said that" → remove the item.
6. **Treat examples as examples.** When the owner says "for example" or "this is one suggestion", record the underlying need, not the example.
7. **Ask follow-ups.** The owner's answers often raise new questions. Ask them in the next round and say "reflect, then wait" when the owner asked for that.
8. **Apply the answers** in one commit per round, with the decision-log entries. Record removed features only in the log.
9. **Check for leftovers.** Search the documents for terms of removed features. Anything outside the decision log is an error.

## Concrete examples

### Example 1: CORS and presigned URLs (E3)

The revised spec required signed URLs and bucket CORS so the browser could reach storage directly. Asked about it, the owner said: "you are adding requirements I do not want … If we ever have to deal with CORS, we are doing it wrong … I have no idea what presigned URLs are".

Result: the requirement was removed. The platform limits on request size were raised with the owner later, as a separate question. The owner then chose option (b): the transfer is owned by the framework and invisible to the app (DEC-0058).

### Example 2: Queues and webhooks (F5 → G → removal)

The owner first explained the need: GitHub event triggers. Then: "put everything related to inbound webhooks into the 'we will do this later' bucket … DO NOT put it in the specs and say 'we aren't doing this now'". Finally: "remove queue capability completely … except in the decision log".

Result: one decision-log entry. A forbidden-terms check was added to the mechanical validator.

## Anti-patterns

- **Editing before the owner answers.** The owner ended almost every message in the source session with "then wait for my input".
- **Reading several spec versions into the main context.** Conflicting versions confuse the agent. Use a subagent.
- **Labelling an accepted AI recommendation as `owner`.** For Aurora the owner said "Aurora is not my decision — my decision was that I didn't want to make a decision".
- **Citing a decision for values it never set.** KV limits were attributed to DEC-0051, which set none.
- **Keeping removed features as "deferred" notes in the spec.** Future implementing agents may build them.

## Acceptance criteria

- [ ] Every requirement and decision carries one of the origin values.
- [ ] No document was changed during an open question round.
- [ ] Removed features appear only in the decision log, and a search proves it.
- [ ] Every `owner` origin can be traced to a quoted owner statement.

## Files this skill creates / modifies

- `docs/decisions/decision-log.md`: entries with an origin for each answered item.
- `docs/**`: requirement wording, origins and removals.
