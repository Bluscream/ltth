/**
 * Viewer Profiles API
 * 
 * Handles all REST API endpoints for viewer profiles
 */

class ViewerProfilesAPI {
  constructor(plugin) {
    this.plugin = plugin;
    this.api = plugin.api;
    this.db = plugin.db;
  }

  /**
   * Parse a positive integer with bounds.
   */
  parseIntParam(value, fallback, min = 1, max = 1000) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  }

  /**
   * Parse a boolean-like value from request payloads.
   */
  parseBooleanLike(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }
    return false;
  }

  /**
   * Build a normalized update payload with validation.
   */
  sanitizeUpdates(payload = {}) {
    const validators = {
      tts_voice: (v) => typeof v === 'string' || v === null || v === '',
      discord_username: (v) => typeof v === 'string' || v === null || v === '',
      birthday: (v) => {
        if (v === null || v === '') return true;
        return /^\d{4}-\d{2}-\d{2}$/.test(v);
      },
      notes: (v) => typeof v === 'string' || v === null || v === '',
      tags: (v) => Array.isArray(v) || typeof v === 'string' || v === null,
      is_favorite: (v) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string',
      is_blocked: (v) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string',
      is_moderator: (v) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string',
      is_vip: (v) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string',
      vip_tier: (v) => typeof v === 'string' || v === null || v === ''
    };

    const allowedFields = Object.keys(validators);
    const updates = {};
    const errors = [];

    for (const field of allowedFields) {
      if (payload[field] === undefined) {
        continue;
      }

      const value = payload[field];
      if (!validators[field](value)) {
        errors.push(`Invalid value for field '${field}'`);
        continue;
      }

      if (field === 'tags') {
        if (Array.isArray(value)) {
          updates[field] = value;
        } else if (typeof value === 'string') {
          updates[field] = value
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean);
        } else {
          updates[field] = [];
        }
        continue;
      }

      if (['is_favorite', 'is_blocked', 'is_moderator', 'is_vip'].includes(field)) {
        updates[field] = this.parseBooleanLike(value) ? 1 : 0;
        continue;
      }

      updates[field] = value;
    }

    return { updates, errors };
  }

  /**
   * Emit an updated viewer payload to connected clients.
   */
  emitViewerUpdate(username, reason = 'updated') {
    try {
      const viewer = this.db.getViewerInsights(username) || this.db.getViewerByUsername(username);
      this.api.emit('viewer:updated', {
        username,
        reason,
        viewer
      });
      return viewer;
    } catch (error) {
      this.api.log(`Error emitting viewer update for ${username}: ${error.message}`, 'warn');
      return null;
    }
  }

  /**
   * Register all API routes
   */
  registerRoutes() {
    // Get viewer list with pagination and filters
    this.api.registerRoute('GET', '/api/viewer-profiles', (req, res) => {
      this.getViewerList(req, res);
    });

    // Register specific routes BEFORE parameterized routes
    // This ensures Express matches them correctly

    this.api.registerRoute('GET', '/api/viewer-profiles/insights/overview', (req, res) => {
      this.getOverviewInsights(req, res);
    });

    this.api.registerRoute('GET', '/api/viewer-profiles/insights/segments', (req, res) => {
      this.getSegments(req, res);
    });

    this.api.registerRoute('GET', '/api/viewer-profiles/insights/segments/:segment', (req, res) => {
      this.getSegmentViewers(req, res);
    });

    // Get statistics summary
    this.api.registerRoute('GET', '/api/viewer-profiles/stats/summary', (req, res) => {
      this.getStatsSummary(req, res);
    });

    // Get leaderboard
    this.api.registerRoute('GET', '/api/viewer-profiles/leaderboard', (req, res) => {
      this.getLeaderboard(req, res);
    });

    // Get VIP list
    this.api.registerRoute('GET', '/api/viewer-profiles/vip/list', (req, res) => {
      this.getVIPList(req, res);
    });

    // Get VIP tiers configuration
    this.api.registerRoute('GET', '/api/viewer-profiles/vip/tiers', (req, res) => {
      this.getVIPTiers(req, res);
    });

    // Get upcoming birthdays
    this.api.registerRoute('GET', '/api/viewer-profiles/birthdays/upcoming', (req, res) => {
      this.getUpcomingBirthdays(req, res);
    });

    // Get global heatmap
    this.api.registerRoute('GET', '/api/viewer-profiles/heatmap/global', (req, res) => {
      this.getGlobalHeatmap(req, res);
    });

    // Export viewers
    this.api.registerRoute('GET', '/api/viewer-profiles/export', (req, res) => {
      this.exportViewers(req, res);
    });

    // Get active sessions
    this.api.registerRoute('GET', '/api/viewer-profiles/sessions/active', (req, res) => {
      this.getActiveSessions(req, res);
    });

    // Bulk update endpoint
    this.api.registerRoute('POST', '/api/viewer-profiles/bulk/update', (req, res) => {
      this.bulkUpdateViewers(req, res);
    });

    // Get available TTS voices
    this.api.registerRoute('GET', '/api/viewer-profiles/tts/voices', (req, res) => {
      this.getTTSVoices(req, res);
    });

    // Now register parameterized routes (less specific, must come after)

    // Get viewer heatmap
    this.api.registerRoute('GET', '/api/viewer-profiles/:username/heatmap', (req, res) => {
      this.getViewerHeatmap(req, res);
    });

    // Get viewer insights
    this.api.registerRoute('GET', '/api/viewer-profiles/:username/insights', (req, res) => {
      this.getViewerInsights(req, res);
    });

    // Set VIP status
    this.api.registerRoute('POST', '/api/viewer-profiles/:username/vip', (req, res) => {
      this.setVIPStatus(req, res);
    });

    // Get single viewer profile
    this.api.registerRoute('GET', '/api/viewer-profiles/:username', (req, res) => {
      this.getViewerProfile(req, res);
    });

    // Update viewer profile
    this.api.registerRoute('PATCH', '/api/viewer-profiles/:username', (req, res) => {
      this.updateViewerProfile(req, res);
    });

    this.api.log('Viewer Profiles API routes registered', 'info');
  }

  /**
   * Get viewer list with pagination and filters
   */
  getViewerList(req, res) {
    try {
      const page = this.parseIntParam(req.query.page, 1, 1, 100000);
      const limit = this.parseIntParam(req.query.limit, 50, 1, 200);
      const sortBy = req.query.sortBy || 'total_coins_spent';
      const order = req.query.order || 'DESC';
      const search = req.query.search || '';
      const filter = req.query.filter || 'all';
      const segment = req.query.segment || 'all';

      const result = this.db.getViewers({
        page,
        limit,
        sortBy,
        order,
        search,
        filter,
        segment
      });

      const enrichedViewers = result.viewers.map(viewer => (
        this.db.getViewerInsights(viewer.tiktok_username) || viewer
      ));

      res.json({
        success: true,
        data: enrichedViewers,
        pagination: result.pagination
      });
    } catch (error) {
      this.api.log(`Error getting viewer list: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get single viewer profile with details
   */
  getViewerProfile(req, res) {
    try {
      const username = req.params.username;
      const viewer = this.db.getViewerInsights(username);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found'
        });
      }

      res.json({
        success: true,
        data: viewer
      });
    } catch (error) {
      this.api.log(`Error getting viewer profile: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Update viewer profile (custom fields only)
   */
  updateViewerProfile(req, res) {
    try {
      const username = req.params.username;
      const { updates, errors } = this.sanitizeUpdates(req.body);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors
        });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields provided'
        });
      }

      if (updates.tags) {
        updates.tags = JSON.stringify(updates.tags);
      }

      const viewer = this.db.updateViewer(username, updates);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found'
        });
      }

      res.json({
        success: true,
        data: viewer
      });

      // Emit update event
      this.emitViewerUpdate(username, 'profile-updated');

    } catch (error) {
      this.api.log(`Error updating viewer profile: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Set VIP status
   */
  setVIPStatus(req, res) {
    try {
      const username = req.params.username;
      const { tier, remove } = req.body;

      const viewer = this.plugin.vipManager.setVIP(username, tier, remove);

      res.json({
        success: true,
        data: viewer
      });

      this.emitViewerUpdate(username, remove ? 'vip-removed' : 'vip-updated');
    } catch (error) {
      this.api.log(`Error setting VIP status: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get viewer heatmap
   */
  getViewerHeatmap(req, res) {
    try {
      const username = req.params.username;
      const viewer = this.db.getViewerByUsername(username);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found'
        });
      }

      const heatmap = this.db.getViewerHeatmap(viewer.id);

      res.json({
        success: true,
        data: {
          username,
          heatmap
        }
      });
    } catch (error) {
      this.api.log(`Error getting viewer heatmap: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get statistics summary
   */
  getStatsSummary(req, res) {
    try {
      const stats = this.db.getStatsSummary();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      this.api.log(`Error getting stats summary: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(req, res) {
    try {
      const type = req.query.type || 'coins';
      const limit = this.parseIntParam(req.query.limit, 10, 1, 100);

      const leaderboard = this.db.getLeaderboard(type, limit);

      res.json({
        success: true,
        data: leaderboard
      });
    } catch (error) {
      this.api.log(`Error getting leaderboard: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get VIP list
   */
  getVIPList(req, res) {
    try {
      const tier = req.query.tier || null;
      const vips = this.plugin.vipManager.getVIPsByTier(tier);

      res.json({
        success: true,
        data: vips
      });
    } catch (error) {
      this.api.log(`Error getting VIP list: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get upcoming birthdays
   */
  getUpcomingBirthdays(req, res) {
    try {
      const days = this.parseIntParam(req.query.days, 7, 1, 365);
      const birthdays = this.plugin.birthdayManager.getUpcomingBirthdays(days);

      res.json({
        success: true,
        data: birthdays
      });
    } catch (error) {
      this.api.log(`Error getting upcoming birthdays: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get global heatmap
   */
  getGlobalHeatmap(req, res) {
    try {
      const peakTimes = this.db.getGlobalPeakTimes(168); // 7 days * 24 hours

      res.json({
        success: true,
        data: peakTimes
      });
    } catch (error) {
      this.api.log(`Error getting global heatmap: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Export viewers
   */
  exportViewers(req, res) {
    try {
      const format = req.query.format || 'csv';
      const filter = req.query.filter || 'all';

      const viewers = this.db.exportViewers(filter);

      if (format === 'csv') {
        const csv = this.convertToCSV(viewers);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=viewers.csv');
        res.send(csv);
      } else if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=viewers.json');
        res.json(viewers);
      } else {
        res.status(400).json({
          success: false,
          error: 'Invalid format. Use csv or json'
        });
      }
    } catch (error) {
      this.api.log(`Error exporting viewers: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get active sessions
   */
  getActiveSessions(req, res) {
    try {
      const sessions = this.plugin.sessionManager.getActiveSessions();

      res.json({
        success: true,
        data: {
          count: sessions.length,
          sessions
        }
      });
    } catch (error) {
      this.api.log(`Error getting active sessions: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get VIP tiers configuration
   */
  getVIPTiers(req, res) {
    try {
      const tiers = this.plugin.vipManager.getTiers();

      res.json({
        success: true,
        data: tiers
      });
    } catch (error) {
      this.api.log(`Error getting VIP tiers: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Convert data to CSV format
   */
  convertToCSV(data) {
    if (data.length === 0) {
      return '';
    }

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row =>
      Object.values(row).map(val => {
        // Escape quotes and wrap in quotes if contains comma
        const strVal = val === null || val === undefined ? '' : String(val);
        return strVal.includes(',') || strVal.includes('"') ? 
          `"${strVal.replace(/"/g, '""')}"` : strVal;
      }).join(',')
    );

    return [headers, ...rows].join('\n');
  }

  /**
   * Get available TTS voices
   */
  getTTSVoices(req, res) {
    try {
      // Try to get TTS plugin instance if available
      let voices = [];
      
      if (this.api.getPluginInstance) {
        const ttsPlugin = this.api.getPluginInstance('tts');
        if (ttsPlugin && ttsPlugin.getAvailableVoices) {
          voices = ttsPlugin.getAvailableVoices();
        }
      }

      // Fallback to default voices if TTS plugin not available
      if (voices.length === 0) {
        voices = [
          { value: '', label: 'Default' },
          { value: 'de_001', label: 'German Male' },
          { value: 'de_002', label: 'German Female' },
          { value: 'en_us_001', label: 'English US Male' },
          { value: 'en_us_002', label: 'English US Female' }
        ];
      }

      res.json({
        success: true,
        data: voices
      });
    } catch (error) {
      this.api.log(`Error getting TTS voices: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get overview insights for the dashboard.
   */
  getOverviewInsights(req, res) {
    try {
      const limit = this.parseIntParam(req.query.limit, 5, 1, 20);
      const overview = this.db.getOverviewInsights({ limit });

      res.json({
        success: true,
        data: overview
      });
    } catch (error) {
      this.api.log(`Error getting overview insights: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get segment overview list.
   */
  getSegments(req, res) {
    try {
      const limit = this.parseIntParam(req.query.limit, 5, 1, 20);
      const segments = this.db.getSegments({ limit });

      res.json({
        success: true,
        data: segments
      });
    } catch (error) {
      this.api.log(`Error getting segments: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get one segment with its viewers.
   */
  getSegmentViewers(req, res) {
    try {
      const segment = req.params.segment;
      const limit = this.parseIntParam(req.query.limit, 20, 1, 100);
      const data = this.db.getSegmentViewers(segment, { limit });

      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Segment not found'
        });
      }

      res.json({
        success: true,
        data
      });
    } catch (error) {
      this.api.log(`Error getting segment viewers: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get dashboard insights for a single viewer.
   */
  getViewerInsights(req, res) {
    try {
      const username = req.params.username;
      const viewer = this.db.getViewerInsights(username);

      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found'
        });
      }

      res.json({
        success: true,
        data: viewer
      });
    } catch (error) {
      this.api.log(`Error getting viewer insights: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Bulk update multiple viewers.
   */
  bulkUpdateViewers(req, res) {
    try {
      const usernames = Array.isArray(req.body.usernames) ? req.body.usernames : [];
      const { updates, errors } = this.sanitizeUpdates(req.body.updates || {});

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors
        });
      }

      if (usernames.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one username is required'
        });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid bulk update fields provided'
        });
      }

      if (updates.tags) {
        updates.tags = JSON.stringify(updates.tags);
      }

      const updated = this.db.bulkUpdateViewers(usernames, updates);

      for (const username of usernames) {
        this.emitViewerUpdate(username, 'bulk-updated');
      }

      res.json({
        success: true,
        data: {
          updatedCount: updated.length,
          viewers: updated
        }
      });
    } catch (error) {
      this.api.log(`Error bulk updating viewers: ${error.message}`, 'error');
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = ViewerProfilesAPI;
