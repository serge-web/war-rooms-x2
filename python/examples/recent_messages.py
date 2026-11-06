# Recent messages: the last five messages in each of your rooms, newest first.
# Read-only; works for the admin and White Force roles.
import wrx

game = wrx.Game()
for room in await game.rooms():
    print(f"== {room.name} ==")
    count = 0
    async for message in game.room(room).messages(order="newest-first", limit=5):
        count += 1
        who = "admin" if message.sender.isAdmin else (message.sender.loginName or "?")
        body = message.body
        if body.type == "chat":
            text = body.content.text
        elif body.type == "template":
            text = f"[template card {body.content.templateId}]"
        else:
            text = f"[world state, turn {body.content.turn}]"
        print(f"{message.sentAt:%d %b %H:%M}  {who}: {text[:80]}")
    if count == 0:
        print(" (no messages)")
    print()
