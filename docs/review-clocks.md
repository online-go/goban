# Review clocks

A demo board is a review that is not of an OGS game.
Its official line is the game that the controller records.
Only demo boards have a running clock.
Ordinary game clocks and reviews of OGS games do not change.

## Running clock

Each browser rebuilds the running clock from the ordered review log.
It uses the server timestamp `ts` on each message.
The controller sends `clock_running: true` to start the clock, and `clock_running: false` to stop it.
The player on move counts down from their clock at the live move, which is the last official move.

A turn starts at one of these events:

- A game move (`om`) arrives.
- The clock of the player on move is set or cleared at the live move.

An undo goes back to the turn before. That turn keeps the time that it used.

## The controller

The controller does not apply the server's copy of its own node edits.
This rule is the same for text, marks and clocks.
So when the controller sets a clock, it starts the turn at its own estimate of the server time.

The controller applies `clock_running` only from the server's copy, as all other browsers do.
As a result, Pause and Resume show on the controller one round trip after the click.
A move that the controller records in that round trip has a clock error of up to one round trip.

For the controller of any review, a mousedown on the board removes the focus from an input field.
The clock editor of the frontend commits its value on blur, so the value goes before the move.
A text area, such as the comment box, keeps the focus.

## Record

If Record is on (`review_record_moves`), a stone or pass that the controller plays at the live move is a game move.
Goban sends it as `om`, with the clock of the mover after the move as the fifth element.
If the running clock did not time any of the turn, Goban sends no clock.
The clock arithmetic supports byo-yomi, Canadian, Fischer, simple and absolute time.
The time settings of an uploaded SGF take precedence over the time control of the review.

The server puts each game move after the last game move that it has.
So Record sends one game move or undo at a time.
Until a game move or undo comes back, the review reloads, or control changes, Record drops the next stone or undo.
After the controller sends a game move or undo, its next sync names its node with `f` and `m`.
If the controller syncs before the change comes back, that sync puts the review on the node it names.
The change can then move the controller off that node, or delete it.
So when the change comes back, the controller syncs its node again.

## Undo

`undoOfficialMove()` sends `undo`.
On a demo board, each browser removes the undone move from the tree.
A board on the undone move, or after it, goes back to the move before it.
On a review of an OGS game, the undone move stays in the tree.

## Limits

- The controller does not apply clock edits from other sessions on its account until the review reloads.
  A game move recorded from that session saves the mover's clock without the edit, and the saved clock replaces it from then on.
- A clock edit on the undone move, sent in the round trip after an undo, goes to the move before it.
  On other browsers, it can also start the turn again.
  A comment or marks sent there go to the move before it too, until the controller syncs again when the undo comes back.
- Pen marks and deletes do not name a node. In the round trip after a game move, they can go to the new game move.
