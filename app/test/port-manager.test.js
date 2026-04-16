const PortManager = require('../modules/port-manager');

jest.mock('../modules/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('PortManager.resolvePort', () => {
  test('skips excluded fallback ports', async () => {
    const portManager = new PortManager({ preferredPort: 3000, fallbackPorts: [3001, 3002, 3003] });

    portManager.isPortFree = jest.fn(async (port) => port === 3002);
    portManager.findPIDOnPort = jest.fn(() => null);
    portManager.checkIfLTTHInstance = jest.fn(async () => ({ isLTTH: false, pid: null }));

    const result = await portManager.resolvePort({ excludePorts: [3001] });

    expect(result).toEqual({ port: 3002, action: 'fallback' });
    expect(portManager.isPortFree).toHaveBeenCalledWith(3000);
    expect(portManager.isPortFree).not.toHaveBeenCalledWith(3001);
  });

  test('uses fallback when preferred port is excluded', async () => {
    const portManager = new PortManager({ preferredPort: 3000, fallbackPorts: [3001, 3002] });

    portManager.isPortFree = jest.fn(async (port) => port === 3001);
    portManager.findPIDOnPort = jest.fn(() => null);
    portManager.checkIfLTTHInstance = jest.fn(async () => ({ isLTTH: false, pid: null }));

    const result = await portManager.resolvePort({ excludePorts: [3000] });

    expect(result).toEqual({ port: 3001, action: 'fallback' });
    expect(portManager.isPortFree).not.toHaveBeenCalledWith(3000);
    expect(portManager.findPIDOnPort).not.toHaveBeenCalled();
    expect(portManager.checkIfLTTHInstance).not.toHaveBeenCalled();
  });
});
