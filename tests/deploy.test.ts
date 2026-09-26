import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { callDeadlineMs } from '../server/ai/anthropic';

/**
 * `vercel.json`, checked before Vercel sees it. A mistake here fails the whole deployment, and
 * nothing else in the suite reads the file: `"runtime": "nodejs22.x"` sat in it for weeks until a
 * stricter Vercel CLI refused to build anything.
 */

interface FunctionConfig {
  runtime?: string;
  maxDuration?: number | 'max';
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { functions?: Record<string, FunctionConfig> };
const functions = config.functions ?? {};

describe('vercel.json', () => {
  it('names no function runtime Vercel cannot parse', () => {
    /* `runtime` is only for community runtimes, as `package@version`; the Node version comes from
       the project setting or package.json engines */
    for (const [path, entry] of Object.entries(functions)) {
      if (entry.runtime !== undefined) expect(entry.runtime, path).toMatch(/^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+/);
    }
  });

  it('gives every API endpoint a time limit of its own', () => {
    const endpoints = readdirSync('api').filter((name) => name.endsWith('.ts'));
    expect(endpoints.length).toBeGreaterThan(0);
    for (const name of endpoints) expect(functions[`api/${name}`]?.maxDuration, name).toBeDefined();
  });

  it('lets the AI endpoint outlast its own call deadline, so the deadline answers first', () => {
    /* otherwise Vercel stops the function mid-answer and the browser gets a gateway page instead
       of the timeout it knows how to split */
    const limit = functions['api/tender.ts']?.maxDuration;
    expect(typeof limit).toBe('number');
    expect((limit as number) * 1000).toBeGreaterThan(callDeadlineMs() + 10_000);
  });
});

/**
 * The imports an API function makes at runtime, checked the way Node resolves them. Vercel
 * compiles each file under api/ and server/ on its own rather than bundling, and with
 * `"type": "module"` Node then refuses a relative import that has no extension: `from
 * '../server/store'` kills the function before any of our code runs, and every endpoint answers
 * with Vercel's plain-text FUNCTION_INVOCATION_FAILED page instead of JSON. Bun, Vite and vitest
 * all guess the extension, so nothing else in the suite sees it. The first production deploy did.
 */

interface Load {
  from: string;
  specifier: string;
}

/** What a compiled file loads. Type-only imports are erased here, as they are on Vercel. */
function runtimeSpecifiers(file: string): string[] {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true }
  });
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) found.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, outputText, ts.ScriptTarget.ES2022));
  return found;
}

/** The source file an import lands on, whether or not it was written with an extension. */
const sourceOf = (load: Load): string | undefined => {
  const base = normalize(join(dirname(load.from), load.specifier));
  return [base.replace(/\.js$/, '.ts'), `${base}.ts`].find((candidate) => existsSync(candidate));
};

/** Every file the API functions load, starting from api/ and following each import in turn. */
function apiModuleGraph(): { files: string[]; loads: Load[] } {
  const queue = readdirSync('api')
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join('api', name));
  const files = new Set<string>();
  const loads: Load[] = [];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeSpecifiers(file)) {
      const load = { from: file, specifier };
      loads.push(load);
      const target = specifier.startsWith('.') ? sourceOf(load) : undefined;
      if (target) queue.push(target);
    }
  }
  return { files: [...files], loads };
}

describe('API functions under Node', () => {
  const graph = apiModuleGraph();

  it('follows the lazily imported providers too, since each one loads on a first request', () => {
    /* a walk that stopped at api/ would let the next test pass with nothing checked */
    expect(graph.files).toContain(join('server', 'providers', 'gsheet.ts'));
    expect(graph.files).toContain(join('src', 'lib', 'xlsx.ts'));
  });

  it('names every relative import by the .js file Node will look for', () => {
    const unloadable = graph.loads
      .filter((load) => load.specifier.startsWith('.'))
      .filter((load) => !load.specifier.endsWith('.js') || sourceOf(load) === undefined)
      .map((load) => `${load.from} -> ${load.specifier}`);
    expect(unloadable).toEqual([]);
  });

  it('loads nothing through a path alias, which only Vite and TypeScript understand', () => {
    /* `import type` from '@/types' is fine, because it is erased; a value import would crash */
    const aliased = graph.loads.filter((load) => /^@(server)?\//.test(load.specifier)).map((load) => `${load.from} -> ${load.specifier}`);
    expect(aliased).toEqual([]);
  });
});
