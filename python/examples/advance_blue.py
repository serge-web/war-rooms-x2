# Advance Blue (admin only): move each Blue asset about 1 km north-east and burn
# 15% fuel, then put the result in the world-state draft. Nothing is published:
# open the Map room to see the moved symbols, then "Publish world state..." shows
# the change summary first. Run "resupply.py" afterwards to top the fuel back up.
import wrx
import wrx_draft

game = wrx.Game()
if not (await game.context()).isAdmin:
    raise SystemExit("Only the admin can write the world-state draft.")

state = await game.world_state()
if state is None:
    raise SystemExit("No world state has been published yet.")

blue = next((f for f in await game.forces() if f.name == "Blue"), None)
if blue is None:
    raise SystemExit("No force called Blue in this game.")

moved = 0
for asset_id, asset in list(state.assets.items()):
    if asset.forceId != blue.id:
        continue
    state.assets[asset_id] = asset.model_copy(
        update={
            "lat": round(asset.lat + 0.006, 6),
            "lon": round(asset.lon + 0.009, 6),
            "fuel": max(0, asset.fuel - 15),
        }
    )
    moved += 1
    print(f"Moved {asset.title}; fuel {asset.fuel:.0f}% -> {max(0, asset.fuel - 15):.0f}%")

await wrx_draft.write_draft(state)
print(f"\n{moved} Blue assets moved in the draft. Open the Map room to review.")
