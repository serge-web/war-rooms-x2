# Sample scripts

Scripts for the Scripts panel (WP 6.3). In the panel, **Import…** `sample-scripts.json` to add all five, or import single `.py` files. Importing never runs anything.

| Script | Who | Does |
| --- | --- | --- |
| `game_summary.py` | admin, White Force | Prints the game, the turn, the forces, your rooms and the asset count |
| `asset_report.py` | admin, White Force | Health and fuel by force, with pandas, and the assets needing attention |
| `recent_messages.py` | admin, White Force | The last five messages in each of your rooms |
| `advance_blue.py` | admin | Moves Blue's assets about 1 km north-east and burns 15% fuel, into the world-state draft |
| `resupply.py` | admin | Refuels assets below 50% to 100%, into the world-state draft |

The two admin scripts only fill the draft. Nothing is published until you review the change summary in the Map room ("Publish world state…"). Try `advance_blue.py`, look at the map, then `resupply.py`.

`wrx_draft.write_draft` is the runner's interim draft write; WP 6.4 moves it into the SDK.
