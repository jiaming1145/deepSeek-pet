import { HIT_PARTS } from '@ds/protocol';
import { conditionTypeIssues } from './conditions.ts';
import { OVERLAY_PARAMETERS, type Behavior, type BehaviorPack } from './schema.ts';

export interface ResourceCatalogue {
  /** From CompanionModel.motionGroups(): group -> count. */
  motionGroups: Record<string, number>;
  /** From CompanionModel.expressionNames(). */
  expressions: readonly string[];
  /** Parameter ids the model actually declares, for the overlay presets. */
  parameters: readonly string[];
  /** Cubism PART ids (§6.4 keys). Optional: absent = hitParts key resolution is skipped. */
  parts?: readonly string[];
  /** Drawable ids (§6.4 per-drawable override keys). Optional, same rule. */
  drawables?: readonly string[];
}
/** The §4.10 `hitParts` map as the renderer hands it over — structural, no @ds/stage import. */
export type HitPartsInput = Record<string, { part: string; participatesInHitTest: boolean }>;

export interface BoundBehavior extends Behavior { /* resolved refs, no new fields */ }
export interface BoundPack {
  character: string;
  behaviors: BoundBehavior[];
  /** Every behaviour dropped at binding, with the reason. NEVER silently discarded. */
  dropped: { id: string; reason: string }[];
  /** Non-fatal findings: condition type mismatches (§4.2) and unknown hitParts keys (§6.4). */
  warnings: string[];
}
export class BehaviorBindError extends Error {
  readonly usable: number;
  readonly dropped: { id: string; reason: string }[];
  constructor(usable: number, dropped: { id: string; reason: string }[], missing: string[]) {
    super(`角色行为不足：可用 ${usable}/${MIN_USABLE_BEHAVIORS}（缺少：${missing.join('、')}）`);
    this.name = 'BehaviorBindError';
    this.usable = usable;
    this.dropped = dropped;
  }
}
/** THROWS BehaviorBindError when fewer than MIN_USABLE_BEHAVIORS remain (R3-2). */
export const MIN_USABLE_BEHAVIORS = 12;

type Kind = '动作' | '表情' | '参数';

function bindOne(b: Behavior, cat: ResourceCatalogue): { kind: Kind; reason: string } | null {
  if (b.motion !== null) {
    const [group, index] = b.motion;
    const count = cat.motionGroups[group];
    if (count === undefined) return { kind: '动作', reason: `动作组 ${group} 不存在` };
    if (index >= count) return { kind: '动作', reason: `动作 ${group}[${index}] 越界（共 ${count}）` };
  }
  if (b.expression !== null && !cat.expressions.includes(b.expression)) {
    return { kind: '表情', reason: `表情 ${b.expression} 不存在` };
  }
  for (const p of OVERLAY_PARAMETERS[b.overlay]) {
    if (!cat.parameters.includes(p)) return { kind: '参数', reason: `参数 ${p} 未声明（overlay ${b.overlay}）` };
  }
  return null;
}

export function bindResources(pack: BehaviorPack, cat: ResourceCatalogue, hitParts?: HitPartsInput): BoundPack {
  const behaviors: BoundBehavior[] = [];
  const dropped: { id: string; reason: string }[] = [];
  const warnings: string[] = [];
  const missing: Kind[] = [];
  for (const b of pack.behaviors) {
    const fail = bindOne(b, cat);
    if (fail) {
      dropped.push({ id: b.id, reason: fail.reason });
      if (!missing.includes(fail.kind)) missing.push(fail.kind);
      continue;
    }
    for (const issue of conditionTypeIssues(b.when)) warnings.push(`${b.id}: ${issue}`);
    behaviors.push(b);
  }
  // "Usable" = unique behaviour ids whose bound resources all exist (ids are unique by schema).
  const usable = new Set(behaviors.map((b) => b.id)).size;
  if (usable < MIN_USABLE_BEHAVIORS) throw new BehaviorBindError(usable, dropped, missing);

  if (hitParts) {
    const known = cat.parts !== undefined || cat.drawables !== undefined
      ? new Set([...(cat.parts ?? []), ...(cat.drawables ?? [])]) : null;
    for (const [key, v] of Object.entries(hitParts)) {
      if (!(HIT_PARTS as readonly string[]).includes(v.part)) throw new TypeError(`hitParts.${key}.part 不是合法部位：${v.part}`);
      if (known && !known.has(key)) warnings.push(`hitParts.${key} 未在模型中找到（部件或网格）`);
    }
  }
  return { character: pack.character, behaviors, dropped, warnings };
}
