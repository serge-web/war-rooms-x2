# Asset report: health and fuel by force, plus the assets that need attention.
# Read-only. Uses pandas, which loads the first time (a few seconds).
import wrx

game = wrx.Game()
state = await game.world_state()
if state is None:
    raise SystemExit("No world state has been published yet.")

forces = {f.id: f.name for f in await game.forces()}
frame = wrx.to_frame(state)
frame["force"] = frame["forceId"].map(forces)

print(f"Turn {state.turn}: {len(frame)} assets\n")
summary = frame.groupby("force")[["health", "fuel"]].agg(["count", "mean", "min"]).round(1)
print(summary.to_string())

weak = frame[(frame["health"] < 50) | (frame["fuel"] < 25)]
print("\nNeeds attention (health < 50 or fuel < 25):")
print(weak[["force", "title", "state", "health", "fuel"]].to_string(index=False) if len(weak) else " none")
