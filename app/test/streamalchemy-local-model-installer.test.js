const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const LocalModelInstaller = require('../plugins/streamalchemy/backend/local-model-installer');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'streamalchemy-model-installer-'));
}

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
}

function createResponse(body, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    ok: true,
    status: 200,
    headers: {
      get: key => normalizedHeaders[String(key).toLowerCase()] || null
    },
    body: Readable.from([Buffer.from(body)])
  };
}

describe('LocalModelInstaller', () => {
  test('reports missing local model with install metadata', async () => {
    const dataDir = createTempDir();
    const installer = new LocalModelInstaller({
      dataDir,
      env: {},
      logger: createLogger()
    });

    const status = await installer.getStatus({
      comfyRootDir: dataDir,
      selectedPresetId: 'sdxl_lightning_4step'
    });

    expect(status).toEqual(expect.objectContaining({
      state: 'missing',
      model: 'sdxl_lightning_4step',
      fileName: 'sdxl_lightning_4step.safetensors',
      canInstall: true
    }));
    expect(status.targetPath).toBe(path.join(dataDir, 'models', 'checkpoints', 'sdxl_lightning_4step.safetensors'));
  });

  test('downloads one-click preset models into the ComfyUI checkpoint directory and reports installed status', async () => {
    const dataDir = createTempDir();
    const fetchImpl = jest.fn().mockResolvedValue(createResponse('model-bytes', {
      'content-length': '11'
    }));
    const installer = new LocalModelInstaller({
      dataDir,
      fetchImpl,
      env: {},
      logger: createLogger()
    });
    const config = {
      comfyRootDir: dataDir,
      selectedPresetId: 'sdxl_lightning_4step'
    };

    const started = installer.startInstall(config);
    expect(started).toEqual(expect.objectContaining({
      state: 'installing',
      model: 'sdxl_lightning_4step'
    }));

    await installer.waitForCurrentInstall();

    const status = await installer.getStatus(config);
    expect(status).toEqual(expect.objectContaining({
      state: 'installed',
      sizeBytes: 11,
      canInstall: true
    }));
    expect(fs.readFileSync(status.targetPath, 'utf8')).toBe('model-bytes');
    expect(fetchImpl).toHaveBeenCalledWith('https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors?download=true');
  });

  test('disables one-click install cleanly when ComfyUI root is missing', async () => {
    const dataDir = createTempDir();
    const installer = new LocalModelInstaller({
      dataDir,
      fetchImpl: jest.fn(),
      env: {},
      logger: createLogger()
    });

    await expect(installer.getStatus({
      selectedPresetId: 'sdxl_lightning_4step'
    })).resolves.toEqual(expect.objectContaining({
      state: 'missing',
      canInstall: false
    }));
    expect(() => installer.startInstall({
      selectedPresetId: 'sdxl_lightning_4step'
    })).toThrow('MODEL_INSTALL_REQUIRES_COMFY_ROOT');
  });

  test('keeps failed background install visible in status for the UI', async () => {
    const dataDir = createTempDir();
    const installer = new LocalModelInstaller({
      dataDir,
      fetchImpl: jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: jest.fn() },
        body: null
      }),
      env: {},
      logger: createLogger()
    });
    const config = {
      comfyRootDir: dataDir,
      selectedPresetId: 'sdxl_lightning_4step'
    };

    installer.startInstall(config);
    await installer.waitForCurrentInstall();

    await expect(installer.getStatus(config)).resolves.toEqual(expect.objectContaining({
      state: 'failed',
      error: 'MODEL_DOWNLOAD_HTTP_401',
      canInstall: true
    }));
  });

  test('sends Hugging Face bearer token for gated model downloads', async () => {
    const dataDir = createTempDir();
    const fetchImpl = jest.fn().mockResolvedValue(createResponse('token-model'));
    const installer = new LocalModelInstaller({
      dataDir,
      fetchImpl,
      env: { HF_TOKEN: 'hf_test_token' },
      logger: createLogger()
    });
    const config = {
      comfyRootDir: dataDir,
      selectedPresetId: 'sdxl_lightning_4step'
    };

    installer.startInstall(config);
    await installer.waitForCurrentInstall();

    expect(fetchImpl).toHaveBeenCalledWith('https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors?download=true', {
      headers: {
        Authorization: 'Bearer hf_test_token'
      }
    });
  });
});
