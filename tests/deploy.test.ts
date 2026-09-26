import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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
