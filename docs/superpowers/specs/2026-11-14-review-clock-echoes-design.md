# Review clock acknowledgements

The controller applies clock changes before the server replies. An older reply must not replace a newer pending change.

Each clock command carries a unique `clock_request_id`. The server preserves this ID in the review log and broadcasts it unchanged.

Goban keeps confirmed clock timing separate from pending commands. A reply removes only its matching pending command. Goban then applies the remaining commands to a copy of confirmed timing.

Node clocks remain visible during pending edits. After an incoming update, pending edits replace the affected node values until their acknowledgements arrive.

Full-state replay clears pending commands and rebuilds confirmed timing. Commands from other sessions remain authoritative inputs to that replay.
Losing control clears pending commands that the server can reject after the controller changes.

The server change must deploy before clients that depend on command acknowledgements. Ordinary game clocks use their existing path.
