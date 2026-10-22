/**
 * Latency tests: each service function must complete in well under 500 ms.
 * Runs 100 iterations per function and asserts p95 is fast.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../src/store/store.js";
import { EchoDeckService, type ServiceConfig } from "../src/domain/service.js";

const TEST_DIR = path.resolve("test-latency-data-" + process.pid);
const TEST_FILE = path.join(TEST_DIR, "latency-test.json");
const ITERATIONS = 100;
const P95_THRESHOLD_MS = 50; // Well under 500 ms budget

const serviceConfig: ServiceConfig = {
  tz: "UTC",
  demoMode: false,
  maxCardsPerCall: 50,
  maxTextLength: 500,
};

let store: Store;
let service: EchoDeckService;

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

beforeAll(async () => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  store = new Store(TEST_FILE);
  await store.load();
  service = new EchoDeckService(store, serviceConfig);
});

afterAll(async () => {
  await store.waitForWrites();
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
});

describe("latency", () => {
  it(`create_deck p95 < ${P95_THRESHOLD_MS}ms over ${ITERATIONS} calls`, () => {
    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      service.createDeck(
        `Latency Deck ${i}`,
        [{ front: `Q-${i}`, back: `A-${i}` }],
        Date.now(),
      );
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  });

  it(`next_card p95 < ${P95_THRESHOLD_MS}ms over ${ITERATIONS} calls`, () => {
    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      service.nextCard(undefined, Date.now());
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  });

  it(`grade_answer p95 < ${P95_THRESHOLD_MS}ms over ${ITERATIONS} calls`, () => {
    // Get a valid card ID
    const cards = store.getCards();
    const cardId = cards[0].id;
    const ratings = ["again", "hard", "good", "easy"] as const;

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const rating = ratings[i % ratings.length];
      const start = performance.now();
      service.gradeAnswer(cardId, rating, Date.now());
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  });

  it(`get_progress p95 < ${P95_THRESHOLD_MS}ms over ${ITERATIONS} calls`, () => {
    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      service.getProgress(undefined, Date.now());
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = percentile(times, 95);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  });
});
