'use strict';

if (!process.send) {
  console.error(JSON.stringify({ type: 'error', reason: 'ipc-required' }));
  process.exit(2);
}

process.on('message', (raw) => {
  const message = raw && typeof raw === 'object' ? raw : {};
  if (message.type === 'ping') {
    process.send({ type: 'pong', id: message.id, runtime: process.version });
    return;
  }
  if (message.type === 'stop') {
    process.exit(0);
  }
});

process.on('disconnect', () => process.exit(0));
process.send({ type: 'ready', node: process.version, pid: process.pid });
