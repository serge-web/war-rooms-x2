# Resupply (admin only): refuel every asset below 50% fuel to 100%, and put the
# result in the world-state draft. Nothing is published: open the Map room and
# use "Publish world state..." to review the change summary first.
import wrx

game = wrx.Game()
if not (await game.context()).isAdmin:
    raise SystemExit("Only the admin can write the world-state draft.")

state = await game.draft()  # the draft, with your edits; else the published state
if state is None:
    raise SystemExit("No world state has been published yet.")

refuelled = []
for asset_id, asset in list(state.assets.items()):
    if asset.fuel < 50:
        state.assets[asset_id] = asset.model_copy(update={"fuel": 100})
        refuelled.append(f"{asset.title} ({asset.fuel:.0f}% -> 100%)")

if refuelled:
    await game.write_draft(state)
    print(f"Refuelled {len(refuelled)} assets in the draft:")
    for line in refuelled:
        print(" -", line)
else:
    print("Every asset has at least 50% fuel; the draft is unchanged.")
