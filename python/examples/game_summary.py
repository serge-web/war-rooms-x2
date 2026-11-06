# Game summary: who you are, the turn, the forces, your rooms and the map.
# Read-only; works for the admin and White Force roles.
import wrx

game = wrx.Game()
me = await game.context()
setup = await game.setup()
turn = await game.turn()

print("Game:", setup.name)
print("Running as:", "admin" if me.isAdmin else me.roleId)
print("Turn:", f"{turn.turn}, {turn.phase}" if turn else "not started")

print("\nForces:")
for force in await game.forces():
    print(" -", force.name)

print("\nMy rooms:")
for room in await game.rooms():
    print(" -", room.name)

state = await game.world_state()
print("\nAssets on the map:", len(state.assets) if state else 0)
