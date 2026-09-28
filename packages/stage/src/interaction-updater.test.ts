import { describe, expect, it } from 'vitest';
import type { CubismModel } from '@framework/model/cubismmodel';
import {
  INTERACTION_UPDATE_ORDER, InteractionParameterUpdater,
} from './interaction-updater';
import { RichInteractionController } from './interaction-rig';

describe('InteractionParameterUpdater', () => {
  it('writes only parameters declared by the loaded model', () => {
    const controller = new RichInteractionController();
    controller.setEmotion('happy');
    const updater = new InteractionParameterUpdater(
      controller,
      ['ParamEyeLSmile', 'ParamCheekRaiseL'],
      (name) => name as never,
    );
    const calls: [string, number][] = [];
    const model = {
      addParameterValueById: (id: string, value: number) => calls.push([id, value]),
    } as unknown as CubismModel;
    updater.onLateUpdate(model, 0.2);
    expect(updater.activeParameterIds()).toEqual(['ParamEyeLSmile', 'ParamCheekRaiseL']);
    expect(calls.map(([id]) => id)).toEqual(['ParamEyeLSmile', 'ParamCheekRaiseL']);
    expect(updater.frame()?.action).toBe('idle');
  });

  it('runs after drag and overlay but before breath', () => {
    expect(INTERACTION_UPDATE_ORDER).toBe(455);
  });
});
