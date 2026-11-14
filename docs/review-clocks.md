# Review clocks

Demo board clocks use the ordered review log and the server timestamp on each message.
Ordinary game clocks use their existing path.

The controller applies local clock edits and Pause/Resume commands immediately.
Each command includes a unique `clock_request_id` string.
The review server preserves this ID in storage and broadcasts it with the command.

Goban keeps confirmed timing separate from pending commands.
A server message acknowledges only the command with the same ID.
Goban applies the remaining commands to a copy of confirmed timing, in send order.
A pending command cannot take effect before the latest confirmed timing event.
Server timestamps replace local time estimates as acknowledgements arrive.

Pending node edits stay visible when an earlier echo arrives.
Recorded moves use these values and the effective timing.
Commands from another session remain separate, even when their values match a pending command.

Clock edits from other controller sessions must include the node path, `f` and `m`.
A clock edit or clear for the player on move restarts the turn at the live node.
This includes clearing an already absent clock.
Edits on other nodes do not restart the live turn.

A full-state reload clears pending commands and rebuilds confirmed timing from the log.
Losing control also clears pending commands, because the server can reject them after the controller changes.

Record sends one game move or undo at a time.
The next one waits until the server sends the change back, the review reloads, or control changes.
There is no timeout: a late reply does not mean the change failed.
Until the reply arrives, the server's review position can differ from the controller's board.
So the controller's next comment, mark, pen mark, clear or delete names its node.
Edits on the move that a pending undo takes back, or on later moves, are not sent.
That move is deleted when the undo comes back.

Deploy the server support for `clock_request_id` before the client.
Older servers remove unknown fields and cannot acknowledge these commands.
