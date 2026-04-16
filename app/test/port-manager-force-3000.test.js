const PortManager = require('../modules/port-manager');

describe('PortManager force-port-3000 behavior', () => {
  test('returns port 3000 directly when no process is blocking it', async () => {
    const manager = new PortManager({ preferredPort: 3000 });
    jest.spyOn(manager, 'findPIDOnPort').mockReturnValue(null);

    const result = await manager.resolvePort();

    expect(result).toEqual({ port: 3000, action: 'direct' });
  });

  test('returns port 3000 as direct when TIME_WAIT-style (no PID found)', async () => {
    // With the no-test-bind strategy, a missing PID means no process to kill –
    // resolvePort returns 'direct' and server.listen() handles any TIME_WAIT via EADDRINUSE retry.
    const manager = new PortManager({ preferredPort: 3000, killTimeout: 100 });
    jest.spyOn(manager, 'findPIDOnPort').mockReturnValue(null);

    const result = await manager.resolvePort();

    expect(result).toEqual({ port: 3000, action: 'direct' });
  });

  test('kills detected process and still returns port 3000', async () => {
    const manager = new PortManager({ preferredPort: 3000, killTimeout: 100 });
    jest.spyOn(manager, 'findPIDOnPort').mockReturnValue(99999);
    const killSpy = jest.spyOn(manager, 'killProcess').mockResolvedValue(true);

    const result = await manager.resolvePort();

    expect(killSpy).toHaveBeenCalledWith(99999);
    expect(result).toEqual({ port: 3000, action: 'killed_old_instance' });
  });
});
