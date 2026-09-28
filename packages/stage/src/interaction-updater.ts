import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismIdHandle } from '@framework/id/cubismid';
import type { CubismModel } from '@framework/model/cubismmodel';
import { CubismUpdateOrder, ICubismUpdater } from '@framework/motion/icubismupdater';
import {
  INTERACTION_PARAMETER_IDS, RichInteractionController, type InteractionFrame,
  type InteractionParameterId,
} from './interaction-rig';

export const INTERACTION_UPDATE_ORDER = CubismUpdateOrder.CubismUpdateOrder_Drag + 55;
type IdResolver = (name: string) => CubismIdHandle;

/**
 * Applies only parameters the loaded model actually declares. This lets the desktop runtime ship
 * ahead of a particular rig revision: old characters keep working and the richer model lights up
 * automatically as its parameters become available.
 */
export class InteractionParameterUpdater extends ICubismUpdater {
  private readonly ids = new Map<InteractionParameterId, CubismIdHandle>();
  private last: InteractionFrame | null = null;

  constructor(
    readonly controller: RichInteractionController,
    declaredParameterIds: readonly string[],
    resolveId: IdResolver = (name) => CubismFramework.getIdManager().getId(name),
  ) {
    super(INTERACTION_UPDATE_ORDER);
    const declared = new Set(declaredParameterIds);
    for (const name of INTERACTION_PARAMETER_IDS) {
      if (declared.has(name)) this.ids.set(name, resolveId(name));
    }
  }

  activeParameterIds(): InteractionParameterId[] {
    return [...this.ids.keys()];
  }

  frame(): InteractionFrame | null {
    return this.last;
  }

  onLateUpdate(model: CubismModel | null, deltaTimeSeconds: number): void {
    this.last = this.controller.tick(deltaTimeSeconds);
    if (!model) return;
    for (const [name, value] of Object.entries(this.last.parameters)) {
      const id = this.ids.get(name as InteractionParameterId);
      if (id && value !== undefined && value !== 0) model.addParameterValueById(id, value, 1);
    }
  }
}
