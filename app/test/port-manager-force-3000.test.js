const PortManager = require('../modules/port-manager');

describe('PortManager force-port-3000 behavior', () => {
  test('returns preferred port directly when free', async () => {
    const manager = new PortManager({ preferredPort: 3000 });
    jest.spyOn(manager, 'isPortFree').mockResolvedValue(true);

    const result = await manager.resolvePort();

    expect(result).toEqual({ port: 3000, action: 'direct' });
  });

  test('waits for release (TIME_WAIT-style) and still returns port 3000', async () => {
    const manager = new PortManager({ preferredPort: 3000, killTimeout: 10 });
    jest.spyOn(manager, 'isPortFree').mockResolvedValue(false);
    jest.spyOn(manager, 'findPIDOnPort').mockReturnValue(null);
    jest.spyOn(manager, '_waitForPortFree').mockResolvedValue(true);

    const result = await manager.resolvePort();

    expect(result).toEqual({ port: 3000, action: 'waited_for_release' });
  });

  test('kills detected process and still returns port 3000', async () => {
    const manager = new PortManager({ preferredPort: 3000, killTimeout: 10 });
    jest.spyOn(manager, 'isPortFree').mockResolvedValue(false);
    jest.spyOn(manager, 'findPIDOnPort').mockReturnValue(99999);
    const killSpy = jest.spyOn(manager, 'killProcess').mockResolvedValue(true);
    jest.spyOn(manager, '_waitForPortFree').mockResolvedValue(true);

    const result = await manager.resolvePort();

    expect(killSpy).toHaveBeenCalledWith(99999);
    expect(result).toEqual({ port: 3000, action: 'killed_old_instance' });
  });
});
