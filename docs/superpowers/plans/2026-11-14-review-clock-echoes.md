# Review clock echo fix

1. Add regression cases for successive clock edits and successive Pause/Resume commands before acknowledgements.
2. Add a command ID to the shared review type and the server broadcast path.
3. Separate confirmed clock timing from pending local commands.
4. Preserve pending node values when earlier messages arrive.
5. Test other sessions, replay, control changes, clock clears, and recorded moves.
6. Run the repository checks and builds.
7. Update the companion PR dependency and the protocol document.
