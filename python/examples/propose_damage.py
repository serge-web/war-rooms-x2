# Propose damage (White Force only): mark one asset damaged and propose the new
# world state to the admin in the Umpires room. The admin sees it as a card and
# loads it into the draft after the change summary. Change TARGET and the update.
import wrx

TARGET = "Tank Company"

game = wrx.Game()
me = await game.context()
if me.isAdmin:
    raise SystemExit("The admin edits the draft directly; run this as a White Force role.")

state = await game.world_state()
if state is None:
    raise SystemExit("No world state has been published yet.")

asset = next((a for a in state.assets.values() if a.title == TARGET), None)
if asset is None:
    raise SystemExit(f"No asset called {TARGET}.")

health = max(0, asset.health - 60)
state.assets[asset.id] = asset.model_copy(update={"state": "damaged", "health": health})
summary = f"{asset.title} hit by artillery: damaged, health {asset.health:.0f}% -> {health:.0f}%."
await game.post_proposal(state, summary)
print("Proposed to the admin:", summary)
