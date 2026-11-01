// A TCP port on this machine that reaches a port inside a container with no network, through
// `docker exec` (WP 3.3 offline-install test). Each connection runs `nc` in the container and
// pipes bytes both ways, so the container itself never gets a network interface.
//
//   node ops/test/exec-bridge.ts <container> <container port> <local port>
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const [container, inner, local] = process.argv.slice(2)
if (container === undefined || inner === undefined || local === undefined) {
  console.error('usage: exec-bridge.ts <container> <container port> <local port>')
  process.exit(2)
}

const server = createServer((socket) => {
  const nc = spawn('docker', ['exec', '-i', container, 'nc', '127.0.0.1', inner], {
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  socket.pipe(nc.stdin)
  nc.stdout.pipe(socket)
  const close = () => {
    socket.destroy()
    nc.kill()
  }
  socket.on('close', close)
  socket.on('error', close)
  nc.on('exit', close)
})
server.listen(Number(local), '127.0.0.1', () => {
  console.log(`bridge: 127.0.0.1:${local} -> ${container}:127.0.0.1:${inner}`)
})
