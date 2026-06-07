const { compileFlow } = require('../public/js/ifttt-flow-compiler');

describe('IFTTT visual flow compiler', () => {
  test('serializes connected condition nodes into a trigger condition', () => {
    const flow = {
      name: 'Gift gate',
      enabled: true,
      nodes: [
        { id: 'trigger', type: 'trigger', componentId: 'tiktok:gift', config: {} },
        {
          id: 'condition',
          type: 'condition',
          componentId: 'field_value',
          config: { field: 'coins', operator: 'greater_or_equal', value: '100' }
        },
        { id: 'action', type: 'action', componentId: 'overlay:text', config: { text: 'Big gift' } }
      ],
      connections: [
        { fromNode: 'trigger', toNode: 'condition', fromPort: 'default' },
        { fromNode: 'condition', toNode: 'action', fromPort: 'true' }
      ]
    };

    expect(compileFlow(flow)).toEqual({
      name: 'Gift gate',
      description: '',
      trigger_type: 'tiktok:gift',
      trigger_condition: { field: 'coins', operator: 'greater_or_equal', value: '100' },
      actions: [{ type: 'overlay:text', text: 'Big gift' }],
      enabled: 1,
      cooldown: 0,
      priority: 'normal',
      schema_version: 2,
      flow_graph: {
        nodes: flow.nodes,
        connections: flow.connections
      }
    });
  });

  test('orders actions by graph connections instead of node insertion order', () => {
    const flow = {
      name: 'Chained actions',
      enabled: true,
      nodes: [
        { id: 'trigger', type: 'trigger', componentId: 'tiktok:chat', config: {} },
        { id: 'second', type: 'action', componentId: 'overlay:text', config: { text: 'Second' } },
        { id: 'first', type: 'action', componentId: 'tts:speak', config: { text: 'First' } }
      ],
      connections: [
        { fromNode: 'trigger', toNode: 'first', fromPort: 'default' },
        { fromNode: 'first', toNode: 'second', fromPort: 'default' }
      ]
    };

    expect(compileFlow(flow).actions).toEqual([
      { type: 'tts:speak', text: 'First' },
      { type: 'overlay:text', text: 'Second' }
    ]);
  });

  test('keeps the existing no-connection behavior for simple flows', () => {
    const flow = {
      name: 'Simple flow',
      enabled: false,
      nodes: [
        { id: 'trigger', type: 'trigger', componentId: 'tiktok:follow', config: {} },
        { id: 'action', type: 'action', componentId: 'alert:show', config: { message: 'Thanks' } }
      ],
      connections: []
    };

    expect(compileFlow(flow)).toEqual({
      name: 'Simple flow',
      description: '',
      trigger_type: 'tiktok:follow',
      trigger_condition: null,
      actions: [{ type: 'alert:show', message: 'Thanks' }],
      enabled: 0,
      cooldown: 0,
      priority: 'normal',
      schema_version: 2,
      flow_graph: {
        nodes: flow.nodes,
        connections: []
      }
    });
  });

  test('preserves editor metadata and graph data for visual roundtrip', () => {
    const flow = {
      name: 'Roundtrip',
      description: 'Created visually',
      enabled: true,
      cooldown: 7,
      priority: 'high',
      nodes: [
        { id: 'trigger', type: 'trigger', componentId: 'tiktok:chat', config: {} },
        { id: 'action', type: 'action', componentId: 'tts:speak', config: { text: 'Hi {username}' } }
      ],
      connections: [
        { id: 'conn_1', fromNode: 'trigger', toNode: 'action', fromPort: 'default' }
      ]
    };

    expect(compileFlow(flow)).toMatchObject({
      name: 'Roundtrip',
      description: 'Created visually',
      cooldown: 7,
      priority: 'high',
      schema_version: 2,
      flow_graph: {
        nodes: flow.nodes,
        connections: flow.connections
      }
    });
  });
});
