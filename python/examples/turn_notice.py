# Turn notice (admin, White Force): post the turn and the asset count to a room,
# as you. Change ROOM to the room's name. Refused for a room you can only read; in
# adjudication only the White Force posts, and it is exempt.
import wrx

ROOM = "Blue HQ"

game = wrx.Game()
room = next((r for r in await game.rooms() if r.name == ROOM), None)
if room is None:
    raise SystemExit(f"You are not in a room called {ROOM}.")

turn = await game.turn()
state = await game.world_state()
assets = len(state.assets) if state else 0
when = f"turn {turn.turn}, {turn.phase}" if turn else "before the first turn"
text = f"Umpire notice: it is {when}; {assets} assets are on the map."
await game.send_message(room, text)
print(f"Posted to {room.name}: {text}")
