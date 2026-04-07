import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { PresetService, PresetOptions, ImportOptions } from '../modules/PresetService';
import { ILogger } from '../modules/LoggerService';

export class PresetController extends BaseController {
    constructor(
        private readonly presetService: PresetService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * POST /api/presets/export - Export current configuration
     */
    public export = async (req: Request, res: Response) => {
        try {
            const options: PresetOptions = {
                name: req.body.name || 'My Preset',
                description: req.body.description || '',
                author: req.body.author || 'Unknown',
                includeSettings: req.body.includeSettings !== false,
                includeFlows: req.body.includeFlows !== false,
                includeAlerts: req.body.includeAlerts !== false,
                includeGiftSounds: req.body.includeGiftSounds !== false,
                includeVoiceMappings: req.body.includeVoiceMappings !== false,
                includePluginConfigs: req.body.includePluginConfigs !== false,
            };

            const preset = await this.presetService.exportPreset(options);
            this.sendSuccess(res, { preset });
        } catch (error: any) {
            this.logger.error('Preset export failed:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/presets/import - Import a configuration
     */
    public import = async (req: Request, res: Response) => {
        try {
            const { preset, options } = req.body;

            if (!preset) {
                return this.sendError(res, 'Preset data is required', 'Error', 400);
            }

            const importOptions: ImportOptions = {
                overwrite: options?.overwrite || false,
                createBackup: options?.createBackup !== false,
                includeSettings: options?.includeSettings !== false,
                includeFlows: options?.includeFlows !== false,
                includeAlerts: options?.includeAlerts !== false,
                includeGiftSounds: options?.includeGiftSounds !== false,
                includeVoiceMappings: options?.includeVoiceMappings !== false,
                includePluginConfigs: options?.includePluginConfigs !== false,
            };

            const result = await this.presetService.importPreset(preset, importOptions);
            this.sendSuccess(res, result);
        } catch (error: any) {
            this.logger.error('Preset import failed:', error);
            this.sendError(res, error.message);
        }
    };
}
