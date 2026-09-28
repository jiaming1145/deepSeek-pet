import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const EXPRESSION_FILES = {
  F01: 'curious',
  F02: 'joyful',
  F03: 'angry',
  F04: 'sad',
  F05: 'sleepy',
  F06: 'surprised',
  F07: 'awkward',
  F08: 'thinking',
  F09: 'questioning',
  F10: 'listening',
  F11: 'error_panic',
  F12: 'affection',
};

const hash = (text) => createHash('sha256').update(text).digest('hex');

async function loadPresetModule(sourcePath) {
  const source = await readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;
  const scratch = await mkdtemp(join(tmpdir(), 'ds-facial-expressions-'));
  const modulePath = join(scratch, 'facial-expression.mjs');
  await writeFile(modulePath, transpiled, 'utf8');
  try {
    return await import(`${pathToFileURL(modulePath).href}?${Date.now()}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function buildExpression(_id, _preset, controls) {
  return {
    Type: 'Live2D Expression',
    FadeInTime: 0.28,
    FadeOutTime: 0.32,
    Parameters: Object.entries(controls)
      .filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 1e-6)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([parameterId, value]) => ({
        Id: parameterId,
        Value: Number(value.toFixed(4)),
        Blend: 'Add',
      })),
  };
}

async function writeIdempotent(path, text) {
  try {
    const current = await readFile(path, 'utf8');
    if (current === text) return 'unchanged';
    throw new Error(`refusing to overwrite different expression artifact: ${path}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
  return 'created';
}

export async function exportExpressions({ sourcePath, outputDir }) {
  const module = await loadPresetModule(sourcePath);
  const records = [];
  for (const [id, preset] of Object.entries(EXPRESSION_FILES)) {
    const expression = buildExpression(id, preset, module.FACIAL_PRESETS[preset]);
    const text = `${JSON.stringify(expression, null, 2)}\n`;
    const file = `${id}.exp3.json`;
    await writeIdempotent(join(outputDir, file), text);
    records.push({
      id,
      preset,
      file,
      sha256: hash(text),
      parameterCount: expression.Parameters.length,
    });
  }
  const index = {
    schema_version: '1.0',
    source: 'packages/stage/src/facial-expression.ts',
    expressions: records,
  };
  const model3Fragment = {
    FileReferences: {
      Expressions: records.map(({ id, file }) => ({
        Name: id,
        File: `expressions/${file}`,
      })),
    },
  };
  await writeIdempotent(
    join(outputDir, 'model3_expression_fragment.json'),
    `${JSON.stringify(model3Fragment, null, 2)}\n`,
  );
  await writeIdempotent(
    join(outputDir, 'expression_index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return index;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const outputArg = process.argv[2];
  if (!outputArg) throw new Error('usage: node scripts/export-facial-expressions.mjs <output-dir>');
  const projectRoot = resolve(dirname(scriptPath), '..');
  const sourcePath = join(projectRoot, 'packages/stage/src/facial-expression.ts');
  await exportExpressions({ sourcePath, outputDir: resolve(outputArg) });
}
