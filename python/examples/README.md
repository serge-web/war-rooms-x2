# Sample scripts

Scripts for the Scripts panel (WPs 6.3, 6.4). In the panel, **Import…** `sample-scripts.json` to add all seven, or import single `.py` files. Importing never runs anything, and an imported script never publishes without review until the admin turns it on.

| Script | Who | Does |
| --- | --- | --- |
| `game_summary.py` | admin, White Force | Prints the game, the turn, the forces, your rooms and the asset count |
| `asset_report.py` | admin, White Force | Health and fuel by force, with pandas, and the assets needing attention |
| `recent_messages.py` | admin, White Force | The last five messages in each of your rooms |
| `turn_notice.py` | admin, White Force | Posts the turn and the asset count to Blue HQ, as you (`send_message`) |
| `advance_blue.py` | admin | Moves Blue's assets about 1 km north-east and burns 15% fuel, in the world-state draft |
| `resupply.py` | admin | Refuels assets below 50% to 100%, in the world-state draft |
| `propose_damage.py` | White Force | Marks Tank Company damaged and proposes the state to the admin in the Umpires room (`post_proposal`) |

The admin scripts read the draft (`game.draft()`: your draft, or the published state when you hold none) and write it back (`game.write_draft`). Their changes land on top of the draft when the script finishes, so your own edits to other assets are kept. Nothing is published until you review the change summary in the Map room ("Publish world state…"), unless you turn on "Publish without review" for the script. Try `advance_blue.py`, look at the map, then `resupply.py`: it reads the draft, so it builds on the move rather than undoing it.

`propose_damage.py`'s proposal arrives in the Umpires room as a card; the admin's card has "Load into draft…".

After changing a script, run `python python/examples/make_bundle.py` to regenerate the bundle; `pnpm check:python` checks it is current, and `python/tests/test_examples.py` runs every script against the SDK's fake bridge.
